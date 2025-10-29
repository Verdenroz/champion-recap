import { createQuery } from '@tanstack/svelte-query';

export interface RecentRecap {
	gameName: string;
	tagLine: string;
	status: 'processing' | 'completed';
	progress?: number;
	topChampion?: string;
	matches?: number;
	puuid: string;
	updatedAt: number;
}

/**
 * Fetches recent player recaps from DynamoDB
 * Returns the most recently updated recaps (processing or completed)
 */
async function fetchRecentRecaps(): Promise<RecentRecap[]> {
	const response = await fetch('/api/recaps/recent');

	if (!response.ok) {
		throw new Error('Failed to fetch recent recaps');
	}

	return response.json();
}

/**
 * TanStack Query hook for recent recaps
 *
 * Benefits:
 * - Automatic caching and background refetching
 * - Built-in loading/error states
 * - Automatic retries with exponential backoff
 * - Stale-while-revalidate pattern
 *
 * Usage:
 * const recapsQuery = useRecentRecaps();
 *
 * {#if recapsQuery.isLoading}
 *   <LoadingSpinner />
 * {:else if recapsQuery.isError}
 *   <ErrorMessage error={recapsQuery.error} />
 * {:else}
 *   <RecapsList recaps={recapsQuery.data} />
 * {/if}
 */
export function useRecentRecaps() {
	return createQuery<RecentRecap[]>(() => ({
		queryKey: ['recaps', 'recent'],
		queryFn: fetchRecentRecaps,
		staleTime: 1000 * 30, // 30 seconds - recaps update frequently
		refetchInterval: 1000 * 60, // Refetch every 60 seconds to show new processing recaps
		retry: 3, // Retry failed requests 3 times
		retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
	}));
}
