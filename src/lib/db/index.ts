import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = './data/champion-recap.db';

// Ensure the data directory exists
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
	mkdirSync(dbDir, { recursive: true });
}

// Create SQLite database connection
const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
sqlite.pragma('journal_mode = WAL');

// Create drizzle instance
export const db = drizzle(sqlite, { schema });

// Run migrations on startup
export function initializeDatabase() {
	// Create tables if they don't exist
	sqlite.exec(`
    CREATE TABLE IF NOT EXISTS players (
      puuid TEXT PRIMARY KEY,
      game_name TEXT NOT NULL,
      tag_line TEXT NOT NULL,
      summoner_id TEXT,
      account_id TEXT,
      summoner_level INTEGER,
      profile_icon_id INTEGER,
      last_updated INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS match_ids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL UNIQUE,
      puuid TEXT NOT NULL REFERENCES players(puuid),
      game_creation INTEGER NOT NULL,
      cached INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS matches (
      match_id TEXT PRIMARY KEY,
      region TEXT NOT NULL,
      match_data TEXT NOT NULL,
      game_creation INTEGER NOT NULL,
      game_duration INTEGER NOT NULL,
      game_mode TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_match_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL REFERENCES matches(match_id),
      puuid TEXT NOT NULL,
      champion_id INTEGER NOT NULL,
      champion_name TEXT NOT NULL,
      kills INTEGER NOT NULL,
      deaths INTEGER NOT NULL,
      assists INTEGER NOT NULL,
      win INTEGER NOT NULL,
      total_damage_dealt INTEGER NOT NULL,
      total_minions_killed INTEGER NOT NULL,
      gold_earned INTEGER NOT NULL,
      game_duration INTEGER NOT NULL,
      game_creation INTEGER NOT NULL
    );

    -- Indexes for better query performance
    CREATE INDEX IF NOT EXISTS idx_match_ids_puuid ON match_ids(puuid);
    CREATE INDEX IF NOT EXISTS idx_match_ids_game_creation ON match_ids(game_creation);
    CREATE INDEX IF NOT EXISTS idx_matches_game_creation ON matches(game_creation);
    CREATE INDEX IF NOT EXISTS idx_player_match_stats_puuid ON player_match_stats(puuid);
    CREATE INDEX IF NOT EXISTS idx_player_match_stats_match_id ON player_match_stats(match_id);
    CREATE INDEX IF NOT EXISTS idx_player_match_stats_champion_id ON player_match_stats(champion_id);
  `);
}

// Initialize database on import
initializeDatabase();
