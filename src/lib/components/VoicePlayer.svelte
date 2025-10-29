<script lang="ts">
	import { Howl } from 'howler';
	import { onMount, onDestroy } from 'svelte';

	interface VoicePlayerProps {
		audioUrl: string;
		championName: string;
		autoplay?: boolean;
		onEnd?: () => void;
	}

	let { audioUrl, championName, autoplay = false, onEnd }: VoicePlayerProps = $props();

	let isPlaying = $state(false);
	let progress = $state(0);
	let duration = $state(0);
	let sound: Howl | null = $state(null);
	let progressInterval: number | null = null;

	onMount(() => {
		// Initialize Howler sound
		sound = new Howl({
			src: [audioUrl],
			html5: true,
			preload: true,
			onload: () => {
				duration = sound?.duration() || 0;
				if (autoplay) {
					play();
				}
			},
			onplay: () => {
				isPlaying = true;
				startProgressTracking();
			},
			onpause: () => {
				isPlaying = false;
				stopProgressTracking();
			},
			onend: () => {
				isPlaying = false;
				progress = 0;
				stopProgressTracking();
				onEnd?.();
			},
			onstop: () => {
				isPlaying = false;
				progress = 0;
				stopProgressTracking();
			}
		});
	});

	onDestroy(() => {
		sound?.unload();
		stopProgressTracking();
	});

	function play() {
		sound?.play();
	}

	function pause() {
		sound?.pause();
	}

	function togglePlay() {
		if (isPlaying) {
			pause();
		} else {
			play();
		}
	}

	function seek(percentage: number) {
		if (sound && duration > 0) {
			const seekTime = (percentage / 100) * duration;
			sound.seek(seekTime);
			progress = percentage;
		}
	}

	function startProgressTracking() {
		progressInterval = window.setInterval(() => {
			if (sound && isPlaying) {
				const currentTime = sound.seek() as number;
				progress = (currentTime / duration) * 100;
			}
		}, 100);
	}

	function stopProgressTracking() {
		if (progressInterval) {
			clearInterval(progressInterval);
			progressInterval = null;
		}
	}

	function formatTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	let currentTime = $derived.by(() => {
		return (progress / 100) * duration;
	});
</script>

<div class="voice-player card bg-gradient-to-br from-purple-900/30 to-black border border-purple-700/30 shadow-lg">
	<div class="card-body p-4">
		<!-- Champion Name -->
		<div class="flex items-center gap-3 mb-3">
			<span class="iconify lucide--mic-2 text-purple-400 w-5 h-5"></span>
			<span class="text-sm font-semibold text-purple-300">{championName}</span>
		</div>

		<!-- Progress Bar -->
		<div class="mb-3">
			<input
				type="range"
				min="0"
				max="100"
				value={progress}
				oninput={(e) => seek(Number(e.currentTarget.value))}
				class="range range-xs range-primary w-full"
			/>
			<div class="flex justify-between text-xs text-gray-500 mt-1">
				<span>{formatTime(currentTime)}</span>
				<span>{formatTime(duration)}</span>
			</div>
		</div>

		<!-- Controls -->
		<div class="flex items-center justify-center gap-4">
			<button
				onclick={togglePlay}
				class="btn btn-circle btn-primary btn-sm"
				aria-label={isPlaying ? 'Pause' : 'Play'}
			>
				{#if isPlaying}
					<span class="iconify lucide--pause w-4 h-4"></span>
				{:else}
					<span class="iconify lucide--play w-4 h-4"></span>
				{/if}
			</button>
		</div>
	</div>
</div>
