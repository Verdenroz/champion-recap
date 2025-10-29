# Copyright 2025, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions
# are met:
#  * Redistributions of source code must retain the above copyright
#    notice, this list of conditions and the following disclaimer.
#  * Redistributions in binary form must reproduce the above copyright
#    notice, this list of conditions and the following disclaimer in the
#    documentation and/or other materials provided with the distribution.
#  * Neither the name of NVIDIA CORPORATION nor the names of its
#    contributors may be used to endorse or promote products derived
#    from this software without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ``AS IS'' AND ANY
# EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
# PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT OWNER OR
# CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
# EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
# PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
# PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
# OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
# (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
# OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
import json
import os
import io

import boto3
import jieba
import torch
import torchaudio
import triton_python_backend_utils as pb_utils
from f5_tts_trtllm import F5TTS
from pypinyin import Style, lazy_pinyin
from torch.nn.utils.rnn import pad_sequence
from torch.utils.dlpack import from_dlpack, to_dlpack


def get_tokenizer(vocab_file_path: str):
    """
    tokenizer   - "pinyin" do g2p for only chinese characters, need .txt vocab_file
                - "char" for char-wise tokenizer, need .txt vocab_file
                - "byte" for utf-8 tokenizer
                - "custom" if you're directly passing in a path to the vocab.txt you want to use
    vocab_size  - if use "pinyin", all available pinyin types, common alphabets (also those with accent) and symbols
                - if use "char", derived from unfiltered character & symbol counts of custom dataset
                - if use "byte", set to 256 (unicode byte range)
    """
    with open(vocab_file_path, "r", encoding="utf-8") as f:
        vocab_char_map = {}
        for i, char in enumerate(f):
            vocab_char_map[char[:-1]] = i
    vocab_size = len(vocab_char_map)
    return vocab_char_map, vocab_size


def convert_char_to_pinyin(reference_target_texts_list, polyphone=True):
    final_reference_target_texts_list = []
    custom_trans = str.maketrans(
        {";": ",", "“": '"', "”": '"', "‘": "'", "’": "'"}
    )  # add custom trans here, to address oov

    def is_chinese(c):
        return "\u3100" <= c <= "\u9fff"  # common chinese characters

    for text in reference_target_texts_list:
        char_list = []
        text = text.translate(custom_trans)
        for seg in jieba.cut(text):
            seg_byte_len = len(bytes(seg, "UTF-8"))
            if seg_byte_len == len(seg):  # if pure alphabets and symbols
                if char_list and seg_byte_len > 1 and char_list[-1] not in " :'\"":
                    char_list.append(" ")
                char_list.extend(seg)
            elif polyphone and seg_byte_len == 3 * len(seg):  # if pure east asian characters
                seg_ = lazy_pinyin(seg, style=Style.TONE3, tone_sandhi=True)
                for i, c in enumerate(seg):
                    if is_chinese(c):
                        char_list.append(" ")
                    char_list.append(seg_[i])
            else:  # if mixed characters, alphabets and symbols
                for c in seg:
                    if ord(c) < 256:
                        char_list.extend(c)
                    elif is_chinese(c):
                        char_list.append(" ")
                        char_list.extend(lazy_pinyin(c, style=Style.TONE3, tone_sandhi=True))
                    else:
                        char_list.append(c)
        final_reference_target_texts_list.append(char_list)

    return final_reference_target_texts_list


def list_str_to_idx(
    text: list[str] | list[list[str]],
    vocab_char_map: dict[str, int],  # {char: idx}
    padding_value=-1,
):  # noqa: F722
    list_idx_tensors = [torch.tensor([vocab_char_map.get(c, 0) for c in t]) for t in text]  # pinyin or char style
    text = pad_sequence(list_idx_tensors, padding_value=padding_value, batch_first=True)
    return text


class TritonPythonModel:
    def initialize(self, args):
        self.use_perf = True
        self.device = torch.device("cuda")
        self.target_audio_sample_rate = 24000
        self.target_rms = 0.1  # least rms when inference, normalize to if lower
        self.n_fft = 1024
        self.win_length = 1024
        self.hop_length = 256
        self.n_mel_channels = 100
        self.max_mel_len = 4096

        parameters = json.loads(args["model_config"])["parameters"]
        for key, value in parameters.items():
            parameters[key] = value["string_value"]

        self.vocab_char_map, self.vocab_size = get_tokenizer(parameters["vocab_file"])
        self.reference_sample_rate = int(parameters["reference_audio_sample_rate"])
        self.resampler = torchaudio.transforms.Resample(self.reference_sample_rate, self.target_audio_sample_rate)

        # S3 integration for champion voice loading
        self.s3_client = boto3.client('s3')
        self.voice_bucket = parameters.get("voice_bucket", "champion-recap-voices")
        self.champion_cache = {}  # Cache: {champion_id: {"wav": tensor, "text": str, "sample_rate": int}}
        print(f"[F5-TTS] S3 voice bucket configured: {self.voice_bucket}")

        self.tllm_model_dir = parameters["tllm_model_dir"]
        config_file = os.path.join(self.tllm_model_dir, "config.json")
        with open(config_file) as f:
            config = json.load(f)
        self.model = F5TTS(
            config,
            debug_mode=False,
            tllm_model_dir=self.tllm_model_dir,
            model_path=parameters["model_path"],
            vocab_size=self.vocab_size,
        )

        self.vocoder = parameters["vocoder"]
        assert self.vocoder in ["vocos", "bigvgan"]
        if self.vocoder == "vocos":
            self.mel_stft = torchaudio.transforms.MelSpectrogram(
                sample_rate=self.target_audio_sample_rate,
                n_fft=self.n_fft,
                win_length=self.win_length,
                hop_length=self.hop_length,
                n_mels=self.n_mel_channels,
                power=1,
                center=True,
                normalized=False,
                norm=None,
            ).to(self.device)
            self.compute_mel_fn = self.get_vocos_mel_spectrogram
        elif self.vocoder == "bigvgan":
            self.compute_mel_fn = self.get_bigvgan_mel_spectrogram

    def load_champion_voice(self, champion_id: str):
        """
        Load champion reference audio and text from S3 with caching.

        Args:
            champion_id: Champion identifier (e.g., 'yasuo', 'ahri')

        Returns:
            dict: {"wav": tensor, "text": str, "sample_rate": int}
        """
        # Check cache first
        if champion_id in self.champion_cache:
            print(f"[F5-TTS] Cache hit for champion: {champion_id}")
            return self.champion_cache[champion_id]

        print(f"[F5-TTS] Loading champion voice from S3: {champion_id}")

        try:
            # S3 paths
            wav_key = f"champion-voices/{champion_id}/reference.wav"
            txt_key = f"champion-voices/{champion_id}/reference.txt"

            # Download WAV from S3
            print(f"[F5-TTS] Downloading: s3://{self.voice_bucket}/{wav_key}")
            wav_obj = self.s3_client.get_object(Bucket=self.voice_bucket, Key=wav_key)
            wav_bytes = wav_obj['Body'].read()

            # Load audio tensor from bytes
            wav, sr = torchaudio.load(io.BytesIO(wav_bytes))

            # Download text from S3
            print(f"[F5-TTS] Downloading: s3://{self.voice_bucket}/{txt_key}")
            txt_obj = self.s3_client.get_object(Bucket=self.voice_bucket, Key=txt_key)
            reference_text = txt_obj['Body'].read().decode('utf-8').strip()

            # Cache for future requests
            self.champion_cache[champion_id] = {
                "wav": wav,
                "text": reference_text,
                "sample_rate": sr
            }

            print(f"[F5-TTS] Successfully loaded {champion_id}: wav shape={wav.shape}, sr={sr}, text_len={len(reference_text)}")
            return self.champion_cache[champion_id]

        except Exception as e:
            error_msg = f"Failed to load champion voice for '{champion_id}': {str(e)}"
            print(f"[F5-TTS ERROR] {error_msg}")
            raise pb_utils.TritonModelException(error_msg)

    def get_vocos_mel_spectrogram(self, waveform):
        mel = self.mel_stft(waveform)
        mel = mel.clamp(min=1e-5).log()
        return mel.transpose(1, 2)

    def forward_vocoder(self, mel):
        mel = mel.to(torch.float32).contiguous().cpu()
        input_tensor_0 = pb_utils.Tensor.from_dlpack("mel", to_dlpack(mel))

        inference_request = pb_utils.InferenceRequest(
            model_name="vocoder", requested_output_names=["waveform"], inputs=[input_tensor_0]
        )
        inference_response = inference_request.exec()
        if inference_response.has_error():
            raise pb_utils.TritonModelException(inference_response.error().message())
        else:
            waveform = pb_utils.get_output_tensor_by_name(inference_response, "waveform")
            waveform = torch.utils.dlpack.from_dlpack(waveform.to_dlpack()).cpu()

            return waveform

    def execute(self, requests):
        (
            reference_text_list,
            target_text_list,
            reference_target_texts_list,
            estimated_reference_target_mel_len,
            reference_mel_len,
            reference_rms_list,
        ) = [], [], [], [], [], []
        mel_features_list = []
        if self.use_perf:
            torch.cuda.nvtx.range_push("preprocess")
        for request in requests:
            # Extract champion_id first
            champion_id_tensor = pb_utils.get_input_tensor_by_name(request, "champion_id")
            if champion_id_tensor is None:
                raise pb_utils.TritonModelException("Missing required input: champion_id")

            champion_id = champion_id_tensor.as_numpy()[0][0].decode("utf-8")
            print(f"[F5-TTS] Processing request for champion: {champion_id}")

            # Get target text (always required)
            target_text_tensor = pb_utils.get_input_tensor_by_name(request, "target_text")
            if target_text_tensor is None:
                raise pb_utils.TritonModelException("Missing required input: target_text")

            target_text = target_text_tensor.as_numpy()[0][0].decode("utf-8")
            target_text_list.append(target_text)

            # Check if reference_wav is provided
            wav_tensor = pb_utils.get_input_tensor_by_name(request, "reference_wav")

            if wav_tensor is None:
                # Load from S3 using champion_id
                print(f"[F5-TTS] No reference_wav provided, loading from S3 for {champion_id}")
                champion_voice = self.load_champion_voice(champion_id)
                wav = champion_voice["wav"]
                reference_text = champion_voice["text"]
                sr = champion_voice["sample_rate"]

                # Ensure wav is in correct shape (1, N)
                if wav.dim() == 1:
                    wav = wav.unsqueeze(0)
                assert wav.shape[0] == 1, f"Expected mono audio, got shape {wav.shape}"

            else:
                # Use provided reference (for custom voices or testing)
                print(f"[F5-TTS] Using provided reference_wav for {champion_id}")
                wav_lens = pb_utils.get_input_tensor_by_name(request, "reference_wav_len")

                reference_text_tensor = pb_utils.get_input_tensor_by_name(request, "reference_text")
                if reference_text_tensor is None:
                    raise pb_utils.TritonModelException("reference_text required when reference_wav is provided")

                reference_text = reference_text_tensor.as_numpy()[0][0].decode("utf-8")

                wav = from_dlpack(wav_tensor.to_dlpack())
                wav_len = from_dlpack(wav_lens.to_dlpack())
                wav_len = wav_len.squeeze()
                assert wav.shape[0] == 1, "Only support batch size 1 for now."
                wav = wav[:, :wav_len]
                sr = self.reference_sample_rate

            reference_text_list.append(reference_text)
            text = reference_text + target_text
            reference_target_texts_list.append(text)

            ref_rms = torch.sqrt(torch.mean(torch.square(wav)))
            if ref_rms < self.target_rms:
                wav = wav * self.target_rms / ref_rms
            reference_rms_list.append(ref_rms)

            # Resample if needed (sr is from S3 or self.reference_sample_rate)
            if sr != self.target_audio_sample_rate:
                # Create resampler for this specific sample rate if different from default
                if sr != self.reference_sample_rate:
                    temp_resampler = torchaudio.transforms.Resample(sr, self.target_audio_sample_rate)
                    wav = temp_resampler(wav)
                else:
                    wav = self.resampler(wav)

            wav = wav.to(self.device)
            if self.use_perf:
                torch.cuda.nvtx.range_push("compute_mel")
            mel_features = self.compute_mel_fn(wav)
            if self.use_perf:
                torch.cuda.nvtx.range_pop()
            mel_features_list.append(mel_features)

            reference_mel_len.append(mel_features.shape[1])
            estimated_reference_target_mel_len.append(
                int(
                    mel_features.shape[1] * (1 + len(target_text.encode("utf-8")) / len(reference_text.encode("utf-8")))
                )
            )

        max_seq_len = min(max(estimated_reference_target_mel_len), self.max_mel_len)

        batch = len(requests)
        mel_features = torch.zeros((batch, max_seq_len, self.n_mel_channels), dtype=torch.float32).to(self.device)
        for i, mel in enumerate(mel_features_list):
            mel_features[i, : mel.shape[1], :] = mel

        reference_mel_len_tensor = torch.LongTensor(reference_mel_len).to(self.device)

        pinyin_list = convert_char_to_pinyin(reference_target_texts_list, polyphone=True)
        text_pad_sequence = list_str_to_idx(pinyin_list, self.vocab_char_map)

        if self.use_perf:
            torch.cuda.nvtx.range_pop()

        denoised, cost_time = self.model.sample(
            text_pad_sequence,
            mel_features,
            reference_mel_len_tensor,
            estimated_reference_target_mel_len,
            remove_input_padding=False,
            use_perf=self.use_perf,
        )
        if self.use_perf:
            torch.cuda.nvtx.range_push("vocoder")

        responses = []
        for i in range(batch):
            ref_mel_len = reference_mel_len[i]
            estimated_mel_len = estimated_reference_target_mel_len[i]
            denoised_one_item = denoised[i, ref_mel_len:estimated_mel_len, :].unsqueeze(0).transpose(1, 2)
            audio = self.forward_vocoder(denoised_one_item)
            if reference_rms_list[i] < self.target_rms:
                audio = audio * reference_rms_list[i] / self.target_rms

            audio = pb_utils.Tensor.from_dlpack("waveform", to_dlpack(audio))
            inference_response = pb_utils.InferenceResponse(output_tensors=[audio])
            responses.append(inference_response)
        if self.use_perf:
            torch.cuda.nvtx.range_pop()
        return responses
