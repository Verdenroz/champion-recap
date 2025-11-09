import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_AWS_API_URL } from '$env/static/public';

/**
 * Voice generation endpoint - proxies to AWS API Gateway voice generator
 *
 * Query parameters:
 * - text: Text to generate voice for (required)
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const { champion } = params;
	const text = url.searchParams.get('text');

	if (!text) {
		throw error(400, 'Missing required parameter: text');
	}

	if (!PUBLIC_AWS_API_URL) {
		throw error(500, 'AWS API URL not configured');
	}

	try {
		// Call AWS voice generator proxy Lambda
		const voiceApiUrl = `${PUBLIC_AWS_API_URL}/voice/generate`;

		const response = await fetch(voiceApiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				championId: champion.toLowerCase(),
				text: text
			})
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
			console.error('[Voice API] Error from AWS:', errorData);
			throw error(response.status, errorData.error || 'Voice generation failed');
		}

		const data = await response.json();

		// Return voice data with audio URL
		return json({
			championName: champion,
			audioData: data.audio_data, // Base64-encoded WAV
			sampleRate: data.sample_rate,
			duration: data.duration,
			format: data.format,
			modelVersion: 'f5-tts-v1'
		});
	} catch (err) {
		console.error('[Voice API] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		throw error(500, {
			message: err instanceof Error ? err.message : 'Failed to generate voice'
		});
	}
};
