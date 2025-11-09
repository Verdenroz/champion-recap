/**
 * Welcome message endpoint for coaching sessions.
 * Generates initial greeting using highest mastery champion's voice.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChampionNameById } from '$lib/data-dragon';

const AWS_API_URL = import.meta.env.PUBLIC_AWS_API_URL || process.env.PUBLIC_AWS_API_URL;

/**
 * POST /api/coaching/welcome
 * Generate welcome message with champion voice
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { sessionId, championId, puuid } = body;

		if (!sessionId) {
			throw error(400, 'Missing required parameter: sessionId');
		}

		if (!championId) {
			throw error(400, 'Missing required parameter: championId');
		}

		// Convert championId to championName for voice generation
		const championName = await getChampionNameById(championId);
		const championIdString = championName.toLowerCase().replace(/[^a-z0-9]/g, '');

		// Generate welcome message text based on champion personality
		const welcomeText = generateWelcomeMessage(championName);

		// Call AWS voice generation endpoint
		const voiceResponse = await fetch(`${AWS_API_URL}/voice/generate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				championId: championIdString,
				text: welcomeText
			})
		});

		if (!voiceResponse.ok) {
			throw error(500, 'Failed to generate welcome voice');
		}

		const voiceData = await voiceResponse.json();

		// Return welcome message with audio
		return json({
			sessionId,
			champion: championName,
			championId: championIdString,
			text: welcomeText,
			audioData: voiceData.audio_data, // Base64-encoded WAV
			sampleRate: voiceData.sample_rate,
			duration: voiceData.duration,
			format: voiceData.format
		});
	} catch (err) {
		console.error('[Welcome API] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		throw error(500, {
			message: err instanceof Error ? err.message : 'Failed to generate welcome message'
		});
	}
};

/**
 * Generate welcome message based on champion personality
 */
function generateWelcomeMessage(championName: string): string {
	// Champion-specific welcome messages
	const welcomeMessages: Record<string, string> = {
		Yasuo:
			"The wind guides me to your path, Summoner. I'll review your journey with honor and precision.",
		Jinx: "Hey there, hotshot! Ready for some explosive feedback? Let's blow this recap up!",
		Thresh:
			"Ah, another soul seeking guidance. I shall illuminate the darkness of your mistakes, one by one.",
		Ahri: "Welcome, Summoner. Let's see if your plays are as charming as you hoped they'd be.",
		Lux: "Greetings! I'm here to shed some light on your performance. Let's brighten your gameplay!",
		Zed: "The shadows reveal all truths. Prepare to face yours, Summoner.",
		Ashe: "Greetings, Summoner. With clarity and focus, we'll analyze your journey together.",
		Ekko: "Time to rewind and review! Let's see where you can improve, Summoner.",
		Katarina: "Precision is everything. Let's cut through the noise and see your true performance.",
		LeeSin: "One who knows the path needs no map. Let me guide your improvement, Summoner."
	};

	// Return champion-specific message or default
	return (
		welcomeMessages[championName] ||
		`Welcome, Summoner. I am ${championName}, and I'll be reviewing your matches with you. Let's begin your analysis.`
	);
}
