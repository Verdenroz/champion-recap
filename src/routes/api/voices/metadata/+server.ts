import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Mock voice metadata for development
// TODO: Replace with actual S3/CloudFront URLs once Phase 3 (AWS Integration) is complete
export const GET: RequestHandler = async () => {
	const mockVoices = [
		{
			championName: 'Jinx',
			audioUrl: '/audio/jinx-sample.mp3', // Placeholder - will be S3/CloudFront URL
			duration: 5.2,
			language: 'en',
			modelVersion: 'f5-tts-v1'
		},
		{
			championName: 'Yasuo',
			audioUrl: '/audio/yasuo-sample.mp3',
			duration: 4.8,
			language: 'en',
			modelVersion: 'f5-tts-v1'
		},
		{
			championName: 'Ahri',
			audioUrl: '/audio/ahri-sample.mp3',
			duration: 5.5,
			language: 'en',
			modelVersion: 'f5-tts-v1'
		}
	];

	return json({ voices: mockVoices });
};
