import { db } from './index';
import { players, matchIds, matches, playerMatchStats } from './schema';
import type { AccountDto, SummonerDto, MatchDto } from '$lib/types/riot';
import { eq, and, gte, lte, desc, inArray } from 'drizzle-orm';

/**
 * Cache player account and summoner information
 */
export async function cachePlayer(account: AccountDto, summoner?: SummonerDto) {
	await db
		.insert(players)
		.values({
			puuid: account.puuid,
			gameName: account.gameName,
			tagLine: account.tagLine,
			summonerId: summoner?.id,
			accountId: summoner?.accountId,
			summonerLevel: summoner?.summonerLevel,
			profileIconId: summoner?.profileIconId,
			lastUpdated: new Date()
		})
		.onConflictDoUpdate({
			target: players.puuid,
			set: {
				gameName: account.gameName,
				tagLine: account.tagLine,
				summonerId: summoner?.id,
				accountId: summoner?.accountId,
				summonerLevel: summoner?.summonerLevel,
				profileIconId: summoner?.profileIconId,
				lastUpdated: new Date()
			}
		});
}

/**
 * Get cached player data
 */
export async function getCachedPlayer(puuid: string) {
	const result = await db.select().from(players).where(eq(players.puuid, puuid)).limit(1);
	return result[0] || null;
}

/**
 * Cache match IDs for a player
 */
export async function cacheMatchIds(puuid: string, matchIdList: string[], gameCreationTimes: Map<string, number>) {
	const values = matchIdList.map((matchId) => ({
		matchId,
		puuid,
		gameCreation: gameCreationTimes.get(matchId) || Date.now(),
		cached: false,
		createdAt: new Date()
	}));

	if (values.length === 0) return;

	// Insert match IDs, ignore conflicts (already cached)
	await db.insert(matchIds).values(values).onConflictDoNothing();
}

/**
 * Get cached match IDs for a player within a time range
 */
export async function getCachedMatchIds(
	puuid: string,
	startTime?: number,
	endTime?: number
): Promise<string[]> {
	const conditions = [eq(matchIds.puuid, puuid)];

	if (startTime && endTime) {
		conditions.push(gte(matchIds.gameCreation, startTime));
		conditions.push(lte(matchIds.gameCreation, endTime));
	}

	const results = await db
		.select({ matchId: matchIds.matchId })
		.from(matchIds)
		.where(and(...conditions))
		.orderBy(desc(matchIds.gameCreation));

	return results.map((r) => r.matchId);
}

/**
 * Cache a match and its associated player stats
 */
export async function cacheMatch(matchData: MatchDto, region: string) {
	// Cache the full match data
	await db
		.insert(matches)
		.values({
			matchId: matchData.metadata.matchId,
			region,
			matchData: matchData as any,
			gameCreation: matchData.info.gameCreation,
			gameDuration: matchData.info.gameDuration,
			gameMode: matchData.info.gameMode,
			cachedAt: new Date()
		})
		.onConflictDoNothing();

	// Cache player stats for each participant
	const statsValues = matchData.info.participants.map((participant) => ({
		matchId: matchData.metadata.matchId,
		puuid: participant.puuid,
		championId: participant.championId,
		championName: participant.championName,
		kills: participant.kills,
		deaths: participant.deaths,
		assists: participant.assists,
		win: participant.win,
		totalDamageDealt: participant.totalDamageDealtToChampions,
		totalMinionsKilled: participant.totalMinionsKilled + participant.neutralMinionsKilled,
		goldEarned: participant.goldEarned,
		gameDuration: matchData.info.gameDuration,
		gameCreation: matchData.info.gameCreation
	}));

	await db.insert(playerMatchStats).values(statsValues).onConflictDoNothing();

	// Mark the match ID as cached
	await db
		.update(matchIds)
		.set({ cached: true })
		.where(eq(matchIds.matchId, matchData.metadata.matchId));
}

/**
 * Get cached match data
 */
export async function getCachedMatch(matchId: string): Promise<MatchDto | null> {
	const result = await db.select().from(matches).where(eq(matches.matchId, matchId)).limit(1);

	if (result.length === 0) return null;

	return result[0].matchData as MatchDto;
}

/**
 * Get multiple cached matches
 */
export async function getCachedMatches(matchIdList: string[]): Promise<MatchDto[]> {
	if (matchIdList.length === 0) return [];

	const results = await db
		.select()
		.from(matches)
		.where(inArray(matches.matchId, matchIdList))
		.orderBy(desc(matches.gameCreation));

	return results.map((r) => r.matchData as MatchDto);
}

/**
 * Get uncached match IDs for a player
 */
export async function getUncachedMatchIds(puuid: string, limit?: number): Promise<string[]> {
	let query = db
		.select({ matchId: matchIds.matchId })
		.from(matchIds)
		.where(and(eq(matchIds.puuid, puuid), eq(matchIds.cached, false)))
		.orderBy(desc(matchIds.gameCreation));

	if (limit) {
		query = query.limit(limit) as any;
	}

	const results = await query;
	return results.map((r) => r.matchId);
}

/**
 * Check which match IDs are already cached
 */
export async function getMatchCacheStatus(matchIdList: string[]): Promise<{
	cached: string[];
	uncached: string[];
}> {
	if (matchIdList.length === 0) {
		return { cached: [], uncached: [] };
	}

	const results = await db
		.select({ matchId: matches.matchId })
		.from(matches)
		.where(inArray(matches.matchId, matchIdList));

	const cachedSet = new Set(results.map((r) => r.matchId));
	const cached = matchIdList.filter((id) => cachedSet.has(id));
	const uncached = matchIdList.filter((id) => !cachedSet.has(id));

	return { cached, uncached };
}

/**
 * Get player statistics for a specific time period
 */
export async function getPlayerStats(puuid: string, startTime?: number, endTime?: number) {
	const conditions = [eq(playerMatchStats.puuid, puuid)];

	if (startTime && endTime) {
		conditions.push(gte(playerMatchStats.gameCreation, startTime));
		conditions.push(lte(playerMatchStats.gameCreation, endTime));
	}

	return await db
		.select()
		.from(playerMatchStats)
		.where(and(...conditions))
		.orderBy(desc(playerMatchStats.gameCreation));
}
