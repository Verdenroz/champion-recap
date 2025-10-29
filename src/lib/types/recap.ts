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
 * Complete recap data including champion statistics
 * Used for displaying the full year-in-review
 */
export interface RecapData {
	stats: ChampionRecap & {
		totalGames: number;
		totalWins: number;
		totalLosses: number;
	};
}
