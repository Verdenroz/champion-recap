import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Stores player account information
 */
export const players = sqliteTable('players', {
	puuid: text('puuid').primaryKey(),
	gameName: text('game_name').notNull(),
	tagLine: text('tag_line').notNull(),
	summonerId: text('summoner_id'),
	accountId: text('account_id'),
	summonerLevel: integer('summoner_level'),
	profileIconId: integer('profile_icon_id'),
	lastUpdated: integer('last_updated', { mode: 'timestamp' }).notNull()
});

/**
 * Stores match IDs associated with players
 * This allows us to track which matches we've already cached
 */
export const matchIds = sqliteTable('match_ids', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	matchId: text('match_id').notNull().unique(),
	puuid: text('puuid')
		.notNull()
		.references(() => players.puuid),
	gameCreation: integer('game_creation').notNull(),
	cached: integer('cached', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

/**
 * Stores full match data as JSON
 * Normalized storage would be better for querying, but JSON is simpler for this use case
 */
export const matches = sqliteTable('matches', {
	matchId: text('match_id').primaryKey(),
	region: text('region').notNull(),
	matchData: text('match_data', { mode: 'json' }).notNull(), // Store the full MatchDto as JSON
	gameCreation: integer('game_creation').notNull(),
	gameDuration: integer('game_duration').notNull(),
	gameMode: text('game_mode').notNull(),
	cachedAt: integer('cached_at', { mode: 'timestamp' }).notNull()
});

/**
 * Stores player statistics per match (denormalized for quick queries)
 */
export const playerMatchStats = sqliteTable('player_match_stats', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	matchId: text('match_id')
		.notNull()
		.references(() => matches.matchId),
	puuid: text('puuid').notNull(), // Removed foreign key - participants may not be in players table
	championId: integer('champion_id').notNull(),
	championName: text('champion_name').notNull(),
	kills: integer('kills').notNull(),
	deaths: integer('deaths').notNull(),
	assists: integer('assists').notNull(),
	win: integer('win', { mode: 'boolean' }).notNull(),
	totalDamageDealt: integer('total_damage_dealt').notNull(),
	totalMinionsKilled: integer('total_minions_killed').notNull(),
	goldEarned: integer('gold_earned').notNull(),
	gameDuration: integer('game_duration').notNull(),
	gameCreation: integer('game_creation').notNull()
});

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type MatchId = typeof matchIds.$inferSelect;
export type NewMatchId = typeof matchIds.$inferInsert;
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type PlayerMatchStat = typeof playerMatchStats.$inferSelect;
export type NewPlayerMatchStat = typeof playerMatchStats.$inferInsert;
