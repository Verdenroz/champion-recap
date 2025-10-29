import { createQuery } from '@tanstack/svelte-query';

export interface VoiceMetadata {
	championName: string;
	audioUrl: string;
	duration: number;
	language: string;
	modelVersion: string;
}

export interface VoiceMetadataResponse {
	voices: VoiceMetadata[];
}

/**
 * Fetches voice metadata for all champions
 * Assumes voice cloning setup is complete with S3/CloudFront URLs
 */
async function fetchVoiceMetadata(): Promise<VoiceMetadataResponse> {
	// TODO: Replace with actual API endpoint once Phase 3 (AWS Integration) is complete
	// For now, this returns mock data for development
	const response = await fetch('/api/voices/metadata');

	if (!response.ok) {
		throw new Error('Failed to fetch voice metadata');
	}

	return response.json();
}

/**
 * Query hook for voice metadata
 * Usage:
 * const voiceQuery = useVoiceMetadata();
 * {#if voiceQuery.data}
 *   <VoicePlayer audioUrl={voiceQuery.data.voices[0].audioUrl} />
 * {/if}
 */
export function useVoiceMetadata() {
	return createQuery<VoiceMetadataResponse>(() => ({
		queryKey: ['voices', 'metadata'],
		queryFn: fetchVoiceMetadata,
		staleTime: 1000 * 60 * 60, // 1 hour - voice metadata rarely changes
	}));
}

/**
 * Fetches voice metadata for a specific champion
 */
async function fetchChampionVoice(championName: string): Promise<VoiceMetadata> {
	// TODO: Replace with actual API endpoint
	const response = await fetch(`/api/voices/${championName}`);

	if (!response.ok) {
		throw new Error(`Failed to fetch voice for ${championName}`);
	}

	return response.json();
}

/**
 * Query hook for a specific champion's voice
 * Usage:
 * const voiceQuery = useChampionVoice('Jinx');
 * {#if voiceQuery.data}
 *   <VoicePlayer audioUrl={voiceQuery.data.audioUrl} championName={voiceQuery.data.championName} />
 * {/if}
 */
export function useChampionVoice(championName: string) {
	return createQuery<VoiceMetadata>(() => ({
		queryKey: ['voices', 'champion', championName],
		queryFn: () => fetchChampionVoice(championName),
		staleTime: 1000 * 60 * 60, // 1 hour
		enabled: !!championName, // Only fetch if championName is provided
	}));
}
