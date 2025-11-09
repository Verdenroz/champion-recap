import type { AccountDto, SummonerDto, LeagueEntryDto } from './riot';
import type { ChampionRecap } from '../champion-stats';

/**
 * Champion mastery information from Riot API
 */
export interface TopChampionMastery {
	championId: number;
	championLevel: number;
	championPoints: number;
}

/**
 * Combined account data with summoner, ranked, and mastery information
 * Used in recap page for displaying player profile
 */
export interface AccountData {
	puuid: string;
	gameName: string;
	tagLine: string;
	summoner?: SummonerDto;
	rankedEntries?: LeagueEntryDto[];
	topChampionMastery?: TopChampionMastery[];
}

/**
 * Individual match summary for match feed display
 * Lightweight representation of match data for op.gg-style UI
 */
export interface MatchSummary {
	matchId: string;
	gameCreation: number;
	gameDuration: number;
	gameMode: string;
	queueId: number;
	championName: string;
	championId: number;
	kills: number;
	deaths: number;
	assists: number;
	totalMinionsKilled: number;
	visionScore: number;
	win: boolean;
	position: string;
	items: number[];
	summoner1Id: number;
	summoner2Id: number;
	teamChampions: number[]; // Champion IDs of your team (excluding you)
	enemyChampions: number[]; // Champion IDs of enemy team
}

/**
 * Complete recap data including champion statistics and match history
 * Used for displaying the full year-in-review
 */
export interface RecapData {
	stats: ChampionRecap & {
		totalGames: number;
		totalWins: number;
		totalLosses: number;
	};
	matchHistory?: MatchSummary[];
}
