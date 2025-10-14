// Riot Games API Type Definitions

// Account V1 - Get PUUID by Riot ID
export interface AccountDto {
	puuid: string;
	gameName: string;
	tagLine: string;
}

// Summoner V4
export interface SummonerDto {
	id: string;
	accountId: string;
	puuid: string;
	profileIconId: number;
	revisionDate: number;
	summonerLevel: number;
}

// Match V5
export interface MatchDto {
	metadata: MetadataDto;
	info: InfoDto;
}

export interface MetadataDto {
	dataVersion: string;
	matchId: string;
	participants: string[];
}

export interface InfoDto {
	endOfGameResult?: string;
	gameCreation: number;
	gameDuration: number;
	gameEndTimestamp?: number;
	gameId: number;
	gameMode: string;
	gameName: string;
	gameStartTimestamp: number;
	gameType: string;
	gameVersion: string;
	mapId: number;
	participants: ParticipantDto[];
	platformId: string;
	queueId: number;
	teams: TeamDto[];
	tournamentCode?: string;
}

export interface ParticipantDto {
	puuid: string;
	participantId: number;

	// Champion & Player Info
	championId: number;
	championName: string;
	championTransform: number;
	summonerName: string;
	summonerLevel: number;
	summonerId: string;
	riotIdGameName?: string;
	riotIdTagline?: string;
	profileIcon: number;

	// Game Position
	teamId: number;
	teamPosition: string;
	individualPosition: string;
	role: string;
	lane: string;

	// KDA
	kills: number;
	deaths: number;
	assists: number;

	// Combat Stats
	champLevel: number;
	champExperience: number;
	totalDamageDealt: number;
	totalDamageDealtToChampions: number;
	totalDamageTaken: number;
	damageSelfMitigated: number;
	physicalDamageDealt: number;
	physicalDamageDealtToChampions: number;
	physicalDamageTaken: number;
	magicDamageDealt: number;
	magicDamageDealtToChampions: number;
	magicDamageTaken: number;
	trueDamageDealt: number;
	trueDamageDealtToChampions: number;
	trueDamageTaken: number;

	// Gold & Items
	goldEarned: number;
	goldSpent: number;
	item0: number;
	item1: number;
	item2: number;
	item3: number;
	item4: number;
	item5: number;
	item6: number;
	itemsPurchased: number;
	consumablesPurchased: number;

	// Minions & Jungle
	totalMinionsKilled: number;
	neutralMinionsKilled: number;
	totalAllyJungleMinionsKilled: number;
	totalEnemyJungleMinionsKilled: number;

	// Objectives
	baronKills: number;
	dragonKills: number;
	inhibitorKills: number;
	inhibitorTakedowns: number;
	inhibitorsLost: number;
	nexusKills: number;
	nexusTakedowns: number;
	nexusLost: number;
	turretKills: number;
	turretTakedowns: number;
	turretsLost: number;
	objectivesStolen: number;
	objectivesStolenAssists: number;
	damageDealtToBuildings: number;
	damageDealtToObjectives: number;
	damageDealtToTurrets: number;

	// Vision
	visionScore: number;
	visionWardsBoughtInGame: number;
	sightWardsBoughtInGame: number;
	wardsPlaced: number;
	wardsKilled: number;
	detectorWardsPlaced: number;

	// Multikills
	doubleKills: number;
	tripleKills: number;
	quadraKills: number;
	pentaKills: number;
	unrealKills: number;
	killingSprees: number;
	largestKillingSpree: number;
	largestMultiKill: number;

	// Other Stats
	timePlayed: number;
	totalTimeSpentDead: number;
	longestTimeSpentLiving: number;
	largestCriticalStrike: number;
	totalHeal: number;
	totalHealsOnTeammates: number;
	totalUnitsHealed: number;
	totalDamageShieldedOnTeammates: number;
	timeCCingOthers: number;
	totalTimeCCDealt: number;

	// Summoner Spells
	summoner1Id: number;
	summoner2Id: number;
	summoner1Casts: number;
	summoner2Casts: number;

	// Spell Casts
	spell1Casts: number;
	spell2Casts: number;
	spell3Casts: number;
	spell4Casts: number;

	// Pings
	allInPings: number;
	assistMePings: number;
	commandPings: number;
	enemyMissingPings: number;
	enemyVisionPings: number;
	getBackPings: number;
	holdPings: number;
	needVisionPings: number;
	onMyWayPings: number;
	pushPings: number;
	visionClearedPings: number;

	// Game End
	win: boolean;
	gameEndedInEarlySurrender: boolean;
	gameEndedInSurrender: boolean;
	teamEarlySurrendered: boolean;

	// First Blood/Tower
	firstBloodKill: boolean;
	firstBloodAssist: boolean;
	firstTowerKill: boolean;
	firstTowerAssist: boolean;

	// Other
	bountyLevel: number;
	eligibleForProgression: boolean;
	perks?: PerksDto;
	challenges?: ChallengesDto;

	// Arena/Special modes
	placement?: number;
	playerSubteamId?: number;
	subteamPlacement?: number;
	playerAugment1?: number;
	playerAugment2?: number;
	playerAugment3?: number;
	playerAugment4?: number;

	// Legacy
	playerScore0?: number;
	playerScore1?: number;
	playerScore2?: number;
	playerScore3?: number;
	playerScore4?: number;
	playerScore5?: number;
	playerScore6?: number;
	playerScore7?: number;
	playerScore8?: number;
	playerScore9?: number;
	playerScore10?: number;
	playerScore11?: number;
}

export interface PerksDto {
	statPerks: PerkStatsDto;
	styles: PerkStyleDto[];
}

export interface PerkStatsDto {
	defense: number;
	flex: number;
	offense: number;
}

export interface PerkStyleDto {
	description: string;
	selections: PerkStyleSelectionDto[];
	style: number;
}

export interface PerkStyleSelectionDto {
	perk: number;
	var1: number;
	var2: number;
	var3: number;
}

export interface ChallengesDto {
	[key: string]: number | number[] | undefined;
	'12AssistStreakCount'?: number;
	baronBuffGoldAdvantageOverThreshold?: number;
	controlWardTimeCoverageInRiverOrEnemyHalf?: number;
	kda?: number;
	killParticipation?: number;
	gameLength?: number;
	goldPerMinute?: number;
	damagePerMinute?: number;
	visionScorePerMinute?: number;
}

export interface TeamDto {
	bans: BanDto[];
	objectives: ObjectivesDto;
	teamId: number;
	win: boolean;
}

export interface BanDto {
	championId: number;
	pickTurn: number;
}

export interface ObjectivesDto {
	baron: ObjectiveDto;
	champion: ObjectiveDto;
	dragon: ObjectiveDto;
	horde?: ObjectiveDto;
	inhibitor: ObjectiveDto;
	riftHerald: ObjectiveDto;
	tower: ObjectiveDto;
}

export interface ObjectiveDto {
	first: boolean;
	kills: number;
}

// Data Dragon Types
export interface ChampionData {
	[championName: string]: Champion;
}

export interface Champion {
	id: string;
	key: string;
	name: string;
	title: string;
	image: {
		full: string;
		sprite: string;
		group: string;
		x: number;
		y: number;
		w: number;
		h: number;
	};
}

// League V4 - Ranked League Entries
export interface LeagueEntryDto {
	leagueId: string;
	summonerId: string;
	queueType: string; // e.g., "RANKED_SOLO_5x5", "RANKED_FLEX_SR"
	tier: string; // e.g., "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"
	rank: string; // e.g., "I", "II", "III", "IV"
	leaguePoints: number;
	wins: number;
	losses: number;
	hotStreak: boolean;
	veteran: boolean;
	freshBlood: boolean;
	inactive: boolean;
}

export interface PlayerData {
	account: AccountDto;
	summoner: SummonerDto;
	matches: MatchDto[];
	totalMatches: number;
	year: number;
}
