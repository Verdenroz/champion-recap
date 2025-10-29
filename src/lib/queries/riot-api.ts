import { createQuery, createInfiniteQuery } from '@tanstack/svelte-query';
import type { AccountDto, SummonerDto, LeagueEntryDto, MatchDto } from '$lib/types/riot';
import {
	getAccountByRiotId,
	getSummonerByPuuid,
	getRankedLeagueEntries,
	getMatchIdsByPuuid,
	getAllMatchIdsForYear,
	getMatchById,
	getMatchesByIds
} from '$lib/riot-api';

/**
 * Query for fetching account by Riot ID (gameName + tagLine)
 * Caches account data to avoid repeated API calls
 */
export function useAccountByRiotId(gameName: string, tagLine: string, region: string = 'americas') {
	return createQuery<AccountDto>(() => ({
		queryKey: ['account', gameName, tagLine, region],
		queryFn: () => getAccountByRiotId(gameName, tagLine, region),
		staleTime: 1000 * 60 * 60 * 24, // 24 hours - account data rarely changes
		enabled: !!gameName && !!tagLine // Only fetch if both parameters are provided
	}));
}

/**
 * Query for fetching summoner by PUUID
 * Caches summoner data (level, icon, etc.)
 */
export function useSummonerByPuuid(puuid: string, platform: string = 'na1') {
	return createQuery<SummonerDto>(() => ({
		queryKey: ['summoner', puuid, platform],
		queryFn: () => getSummonerByPuuid(puuid, platform),
		staleTime: 1000 * 60 * 30, // 30 minutes - summoner data updates occasionally
		enabled: !!puuid
	}));
}

/**
 * Query for fetching ranked league entries by summoner ID
 * Caches ranked data (tier, rank, LP, etc.)
 */
export function useRankedLeagueEntries(summonerId: string, platform: string = 'na1') {
	return createQuery<LeagueEntryDto[]>(() => ({
		queryKey: ['ranked', summonerId, platform],
		queryFn: () => getRankedLeagueEntries(summonerId, platform),
		staleTime: 1000 * 60 * 10, // 10 minutes - ranked data updates frequently
		enabled: !!summonerId
	}));
}

/**
 * Query for fetching match IDs by PUUID
 * Supports pagination with options
 */
export function useMatchIdsByPuuid(
	puuid: string,
	region: string = 'americas',
	options?: {
		count?: number;
		startTime?: number;
		endTime?: number;
		start?: number;
	}
) {
	return createQuery<string[]>(() => ({
		queryKey: ['matchIds', puuid, region, options],
		queryFn: () => getMatchIdsByPuuid(puuid, region, options),
		staleTime: 1000 * 60 * 60, // 1 hour - match IDs don't change often
		enabled: !!puuid
	}));
}

/**
 * Query for fetching ALL match IDs for a specific year
 * Uses cache to minimize API calls
 */
export function useAllMatchIdsForYear(
	puuid: string,
	region: string = 'americas',
	year: number = new Date().getFullYear()
) {
	return createQuery<string[]>(() => ({
		queryKey: ['matchIds', 'all', puuid, region, year],
		queryFn: () => getAllMatchIdsForYear(puuid, region, year),
		staleTime: 1000 * 60 * 60 * 2, // 2 hours - all match IDs for a year are relatively stable
		enabled: !!puuid
	}));
}

/**
 * Query for fetching a single match by ID
 * Includes built-in caching and retry logic
 */
export function useMatchById(matchId: string, region: string = 'americas') {
	return createQuery<MatchDto>(() => ({
		queryKey: ['match', matchId, region],
		queryFn: () => getMatchById(matchId, region),
		staleTime: 1000 * 60 * 60 * 24 * 7, // 1 week - match data never changes
		enabled: !!matchId,
		retry: 3, // Retry 3 times on failure (important for rate limiting)
		retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000) // Exponential backoff
	}));
}

/**
 * Query for fetching multiple matches by IDs
 * Uses parallel fetching with cache and concurrency control
 */
export function useMatchesByIds(matchIds: string[], region: string = 'americas', concurrentLimit: number = 10) {
	return createQuery<MatchDto[]>(() => ({
		queryKey: ['matches', matchIds, region],
		queryFn: () => getMatchesByIds(matchIds, region, concurrentLimit),
		staleTime: 1000 * 60 * 60 * 24 * 7, // 1 week - match data never changes
		enabled: matchIds.length > 0,
		retry: 2,
		retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000)
	}));
}

/**
 * Infinite query for paginated match fetching
 * Useful for "load more" functionality
 */
export function useInfiniteMatchIds(
	puuid: string,
	region: string = 'americas',
	year: number = new Date().getFullYear(),
	batchSize: number = 20
) {
	const startTime = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
	const endTime = Math.floor(new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000);

	return createInfiniteQuery<{ matchIds: string[]; nextPage?: number }, Error, { matchIds: string[]; nextPage?: number }, (string | number)[], number>(() => ({
		queryKey: ['matchIds', 'infinite', puuid, region, year],
		queryFn: async ({ pageParam }) => {
			const matchIds = await getMatchIdsByPuuid(puuid, region, {
				startTime,
				endTime,
				start: pageParam,
				count: batchSize
			});

			return {
				matchIds,
				nextPage: matchIds.length === batchSize ? pageParam + batchSize : undefined
			};
		},
		getNextPageParam: (lastPage) => lastPage.nextPage,
		initialPageParam: 0,
		staleTime: 1000 * 60 * 60, // 1 hour
		enabled: !!puuid
	}));
}
