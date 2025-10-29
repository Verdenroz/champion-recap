import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Mock voice data for individual champions
// TODO: Replace with actual S3/CloudFront URLs once Phase 3 is complete
const mockVoiceData: Record<string, any> = {
	Jinx: {
		championName: 'Jinx',
		audioUrl: '/audio/jinx-sample.mp3',
		duration: 5.2,
		language: 'en',
		modelVersion: 'f5-tts-v1'
	},
	Yasuo: {
		championName: 'Yasuo',
		audioUrl: '/audio/yasuo-sample.mp3',
		duration: 4.8,
		language: 'en',
		modelVersion: 'f5-tts-v1'
	},
	Ahri: {
		championName: 'Ahri',
		audioUrl: '/audio/ahri-sample.mp3',
		duration: 5.5,
		language: 'en',
		modelVersion: 'f5-tts-v1'
	}
};

export const GET: RequestHandler = async ({ params }) => {
	const { champion } = params;

	const voiceData = mockVoiceData[champion];

	if (!voiceData) {
		throw error(404, `Voice not found for champion: ${champion}`);
	}

	return json(voiceData);
};
