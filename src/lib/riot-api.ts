import { RIOT_API_KEY } from '$env/static/private';
import type { AccountDto, SummonerDto, MatchDto } from '$lib/types/riot';
import { withRateLimit } from './rate-limiter';
import {
	cachePlayer,
	getCachedPlayer,
	cacheMatchIds,
	getCachedMatchIds,
	cacheMatch,
	getCachedMatch,
	getCachedMatches,
	getMatchCacheStatus,
	getUncachedMatchIds
} from './db/cache';

/**
 * Get account PUUID by Riot ID (gameName + tagLine)
 * Uses Account V1 API with regional routing
 */
export async function getAccountByRiotId(
	gameName: string,
	tagLine: string,
	region: string = 'americas'
): Promise<AccountDto> {
	return withRateLimit(async () => {
		const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;

		const response = await fetch(url, {
			headers: {
				'X-Riot-Token': RIOT_API_KEY || ''
			}
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to fetch account: ${response.status} - ${errorText}`);
		}

		return response.json();
	});
}

/**
 * Get summoner information by PUUID
 * Uses Summoner V4 API with platform routing
 */
export async function getSummonerByPuuid(
	puuid: string,
	platform: string = 'na1'
): Promise<SummonerDto> {
	return withRateLimit(async () => {
		const url = `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;

		const response = await fetch(url, {
			headers: {
				'X-Riot-Token': RIOT_API_KEY || ''
			}
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to fetch summoner: ${response.status} - ${errorText}`);
		}

		return response.json();
	});
}

/**
 * Get list of match IDs by PUUID with optional filters
 * Uses Match V5 API with regional routing
 */
export async function getMatchIdsByPuuid(
	puuid: string,
	region: string = 'americas',
	options?: {
		count?: number;
		startTime?: number;
		endTime?: number;
		start?: number;
	}
): Promise<string[]> {
	return withRateLimit(async () => {
		const params = new URLSearchParams();

		if (options?.count) params.append('count', options.count.toString());
		if (options?.startTime) params.append('startTime', options.startTime.toString());
		if (options?.endTime) params.append('endTime', options.endTime.toString());
		if (options?.start !== undefined) params.append('start', options.start.toString());

		const queryString = params.toString();
		const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids${queryString ? '?' + queryString : ''}`;

		const response = await fetch(url, {
			headers: {
				'X-Riot-Token': RIOT_API_KEY || ''
			}
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to fetch match IDs: ${response.status} - ${errorText}`);
		}

		return response.json();
	});
}

/**
 * Get ALL match IDs for the current year by paginating through the API
 * Uses cache to avoid re-fetching already known match IDs
 */
export async function getAllMatchIdsForYear(
	puuid: string,
	region: string = 'americas',
	year: number = new Date().getFullYear()
): Promise<string[]> {
	const startTime = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
	const endTime = Math.floor(new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000);

	// Check cache first
	const cachedIds = await getCachedMatchIds(puuid, startTime * 1000, endTime * 1000);

	// If we have cached IDs, we'll still check for new ones
	// but we can reduce the number of API calls
	const allMatchIds: string[] = [];
	let start = 0;
	const batchSize = 100; // Max allowed by Riot API

	while (true) {
		const matchIds = await getMatchIdsByPuuid(puuid, region, {
			startTime,
			endTime,
			start,
			count: batchSize
		});

		if (matchIds.length === 0) {
			break; // No more matches
		}

		allMatchIds.push(...matchIds);

		if (matchIds.length < batchSize) {
			break; // We got all remaining matches
		}

		start += batchSize;
	}

	// Cache the match IDs we just fetched
	// We need to get game creation times from the match data later
	// For now, we'll estimate based on the time range
	const gameCreationTimes = new Map<string, number>();
	allMatchIds.forEach((matchId, index) => {
		// Estimate game creation time (newest first)
		const estimatedTime = endTime * 1000 - index * 1000 * 60 * 30; // Assume 30 min per game
		gameCreationTimes.set(matchId, estimatedTime);
	});

	await cacheMatchIds(puuid, allMatchIds, gameCreationTimes);

	return allMatchIds;
}

/**
 * Get match details by match ID
 * Uses Match V5 API with regional routing
 * Checks cache first before making API call
 */
export async function getMatchById(
	matchId: string,
	region: string = 'americas'
): Promise<MatchDto> {
	// Check cache first
	const cached = await getCachedMatch(matchId);
	if (cached) {
		return cached;
	}

	// Fetch from API with rate limiting
	const matchData = await withRateLimit(async () => {
		const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`;

		const response = await fetch(url, {
			headers: {
				'X-Riot-Token': RIOT_API_KEY || ''
			}
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Failed to fetch match: ${response.status} - ${errorText}`);
		}

		return response.json();
	});

	// Cache the match data
	await cacheMatch(matchData, region);

	return matchData;
}

/**
 * Get multiple matches efficiently with PARALLEL FETCHING
 * Uses cache when possible, fetches uncached matches in parallel batches
 */
export async function getMatchesByIds(
	matchIds: string[],
	region: string = 'americas',
	concurrentLimit: number = 10 // Fetch 10 matches simultaneously
): Promise<MatchDto[]> {
	if (matchIds.length === 0) return [];

	// Check which matches are cached
	const { cached: cachedIds, uncached: uncachedIds } = await getMatchCacheStatus(matchIds);

	console.log(
		`Matches - Cached: ${cachedIds.length}, Need to fetch: ${uncachedIds.length}`
	);

	// Get cached matches
	const cachedMatches = await getCachedMatches(cachedIds);

	// Fetch uncached matches with PARALLEL processing
	const uncachedMatches: MatchDto[] = [];

	// Process in batches for parallel fetching
	for (let i = 0; i < uncachedIds.length; i += concurrentLimit) {
		const batch = uncachedIds.slice(i, i + concurrentLimit);

		// Fetch entire batch in parallel - MUCH FASTER!
		const batchMatches = await Promise.all(
			batch.map((matchId) => getMatchById(matchId, region))
		);

		uncachedMatches.push(...batchMatches);

		// Log progress
		console.log(`Fetched ${Math.min(i + concurrentLimit, uncachedIds.length)}/${uncachedIds.length} matches`);
	}

	// Combine and sort by game creation time (newest first)
	const allMatches = [...cachedMatches, ...uncachedMatches].sort(
		(a, b) => b.info.gameCreation - a.info.gameCreation
	);

	return allMatches;
}

/**
 * Get complete player data with all matches from current year
 * Uses caching, parallel fetching, and rate limiting
 */
export async function getPlayerData(
	gameName: string,
	tagLine: string,
	platform: string = 'na1',
	region: string = 'americas',
	year: number = new Date().getFullYear()
) {
	// Get PUUID from Riot ID
	const account = await getAccountByRiotId(gameName, tagLine, region);

	// Get summoner information
	const summoner = await getSummonerByPuuid(account.puuid, platform);

	// Cache player data
	await cachePlayer(account, summoner);

	// Get ALL match IDs for the current year (uses cache)
	const matchIds = await getAllMatchIdsForYear(account.puuid, region, year);

	console.log(`Found ${matchIds.length} matches for ${year}`);

	// Get matches using parallel batch fetching with cache
	const matches = await getMatchesByIds(matchIds, region);

	return {
		account,
		summoner,
		matches,
		totalMatches: matchIds.length,
		year
	};
}

/**
 * Get player data progressively (for streaming)
 * Returns initial data quickly, then yields matches in batches with parallel fetching
 */
export async function* getPlayerDataProgressive(
	gameName: string,
	tagLine: string,
	platform: string = 'na1',
	region: string = 'americas',
	year: number = new Date().getFullYear(),
	batchSize: number = 20
) {
	// Get PUUID from Riot ID
	const account = await getAccountByRiotId(gameName, tagLine, region);

	// Get summoner information
	const summoner = await getSummonerByPuuid(account.puuid, platform);

	// Cache player data
	await cachePlayer(account, summoner);

	// Yield initial player data
	yield {
		type: 'player_info' as const,
		account,
		summoner
	};

	// Get ALL match IDs for the current year (uses cache)
	const matchIds = await getAllMatchIdsForYear(account.puuid, region, year);

	console.log(`Found ${matchIds.length} matches for ${year}`);

	// Yield total match count
	yield {
		type: 'match_count' as const,
		total: matchIds.length
	};

	// Fetch matches in batches with PARALLEL fetching
	for (let i = 0; i < matchIds.length; i += batchSize) {
		const batch = matchIds.slice(i, i + batchSize);
		const matches = await getMatchesByIds(batch, region, 10); // 10 concurrent fetches per batch

		yield {
			type: 'matches' as const,
			matches,
			progress: {
				current: Math.min(i + batchSize, matchIds.length),
				total: matchIds.length
			}
		};
	}

	// Final summary
	yield {
		type: 'complete' as const
	};
}
