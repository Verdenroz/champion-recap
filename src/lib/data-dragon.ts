const DATA_DRAGON_BASE = 'https://ddragon.leagueoflegends.com/cdn';
const STATIC_DATA_BASE = 'https://static.developer.riotgames.com/docs/lol';

/**
 * Cache for fetched static data to avoid repeated requests
 */
const cache = {
	version: null as string | null,
	queues: null as QueueData[] | null,
	maps: null as MapData[] | null,
	gameModes: null as GameModeData[] | null,
	gameTypes: null as GameTypeData[] | null,
	champions: null as Record<string, any> | null
};

/**
 * Types for Riot's static data
 */
interface QueueData {
	queueId: number;
	map: string;
	description: string | null;
	notes: string | null;
}

interface MapData {
	mapId: number;
	mapName: string;
	notes: string | null;
}

interface GameModeData {
	gameMode: string;
	description: string;
}

interface GameTypeData {
	gameType: string;
	description: string;
}

/**
 * Fetch and cache the latest Data Dragon version
 */
async function fetchLatestVersion(): Promise<string> {
	try {
		const response = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');

		if (!response.ok) {
			console.error('Failed to fetch versions.json');
			return '15.20.1'; // Fallback
		}

		const versions: string[] = await response.json();
		cache.version = versions[0]; // Latest version is first in array
		console.log('Using Data Dragon version:', cache.version);
		return cache.version;
	} catch (error) {
		console.error('Failed to fetch latest version:', error);
		return '15.20.1'; // Fallback
	}
}

/**
 * Get the current cached version or fallback
 */
function getVersion(): string {
	return cache.version || '15.20.1';
}

/**
 * Get the URL for a champion square icon
 */
export function getChampionIconUrl(championName: string): string {
	const version = getVersion();
	return `${DATA_DRAGON_BASE}/${version}/img/champion/${championName}.png`;
}

/**
 * Get the URL for a champion splash art
 */
export function getChampionSplashUrl(championName: string, skinNum: number = 0): string {
	return `${DATA_DRAGON_BASE}/img/champion/splash/${championName}_${skinNum}.jpg`;
}

/**
 * Get the URL for a profile icon
 */
export function getProfileIconUrl(iconId: number): string {
	const version = getVersion();
	return `${DATA_DRAGON_BASE}/${version}/img/profileicon/${iconId}.png`;
}

/**
 * Get the URL for an item icon
 */
export function getItemIconUrl(itemId: number): string {
	const version = getVersion();
	return `${DATA_DRAGON_BASE}/${version}/img/item/${itemId}.png`;
}

/**
 * Get the URL for a summoner spell icon
 */
export function getSummonerSpellIconUrl(spellName: string): string {
	const version = getVersion();
	return `${DATA_DRAGON_BASE}/${version}/img/spell/${spellName}.png`;
}

/**
 * Fetch queue data from Riot's official queues.json
 */
async function fetchQueues(): Promise<QueueData[]> {
	if (cache.queues) {
		return cache.queues;
	}

	try {
		const response = await fetch(`${STATIC_DATA_BASE}/queues.json`);
		if (!response.ok) {
			throw new Error('Failed to fetch queues.json');
		}
		cache.queues = await response.json();
		return cache.queues!;
	} catch (error) {
		console.error('Failed to fetch queues:', error);
		return [];
	}
}

/**
 * Fetch map data from Riot's official maps.json
 */
async function fetchMaps(): Promise<MapData[]> {
	if (cache.maps) {
		return cache.maps;
	}

	try {
		const response = await fetch(`${STATIC_DATA_BASE}/maps.json`);
		if (!response.ok) {
			throw new Error('Failed to fetch maps.json');
		}
		cache.maps = await response.json();
		return cache.maps!;
	} catch (error) {
		console.error('Failed to fetch maps:', error);
		return [];
	}
}

/**
 * Fetch game mode data from Riot's official gameModes.json
 */
async function fetchGameModes(): Promise<GameModeData[]> {
	if (cache.gameModes) {
		return cache.gameModes;
	}

	try {
		const response = await fetch(`${STATIC_DATA_BASE}/gameModes.json`);
		if (!response.ok) {
			throw new Error('Failed to fetch gameModes.json');
		}
		cache.gameModes = await response.json();
		return cache.gameModes!;
	} catch (error) {
		console.error('Failed to fetch game modes:', error);
		return [];
	}
}

/**
 * Fetch game type data from Riot's official gameTypes.json
 */
async function fetchGameTypes(): Promise<GameTypeData[]> {
	if (cache.gameTypes) {
		return cache.gameTypes;
	}

	try {
		const response = await fetch(`${STATIC_DATA_BASE}/gameTypes.json`);
		if (!response.ok) {
			throw new Error('Failed to fetch gameTypes.json');
		}
		cache.gameTypes = await response.json();
		return cache.gameTypes!;
	} catch (error) {
		console.error('Failed to fetch game types:', error);
		return [];
	}
}

/**
 * Get queue name from queue ID using Riot's official queues.json
 * Returns cached data if available, otherwise returns a fallback
 */
export function getQueueName(queueId: number): string {
	// If we have cached queue data, use it
	if (cache.queues) {
		const queue = cache.queues.find((q) => q.queueId === queueId);
		if (queue && queue.description) {
			return queue.description;
		}
		if (queue && queue.map) {
			return queue.map;
		}
	}

	// Fallback map for common queues
	const fallbackMap: Record<number, string> = {
		0: 'Custom',
		400: 'Normal Draft',
		420: 'Ranked Solo/Duo',
		430: 'Normal Blind',
		440: 'Ranked Flex',
		450: 'ARAM',
		700: 'Clash',
		900: 'ARURF',
		1700: 'Arena',
		1900: 'URF'
	};

	return fallbackMap[queueId] || 'Custom';
}

/**
 * Get map name from map ID using Riot's official maps.json
 */
export function getMapName(mapId: number): string {
	if (cache.maps) {
		const map = cache.maps.find((m) => m.mapId === mapId);
		if (map) {
			return map.mapName;
		}
	}
	return 'Unknown Map';
}

/**
 * Get game mode description from game mode string
 */
export function getGameModeDescription(gameMode: string): string {
	if (cache.gameModes) {
		const mode = cache.gameModes.find((m) => m.gameMode === gameMode);
		if (mode) {
			return mode.description;
		}
	}
	return gameMode;
}

/**
 * Get game type description from game type string
 */
export function getGameTypeDescription(gameType: string): string {
	if (cache.gameTypes) {
		const type = cache.gameTypes.find((t) => t.gameType === gameType);
		if (type) {
			return type.description;
		}
	}
	return gameType;
}

/**
 * Fetch champion data from Data Dragon
 */
async function fetchChampions(): Promise<Record<string, any>> {
	if (cache.champions) {
		return cache.champions;
	}

	try {
		const version = getVersion();
		const response = await fetch(`${DATA_DRAGON_BASE}/${version}/data/en_US/champion.json`);
		if (!response.ok) {
			throw new Error('Failed to fetch champion.json');
		}
		const data = await response.json();
		cache.champions = data.data;
		return cache.champions!;
	} catch (error) {
		console.error('Failed to fetch champions:', error);
		return {};
	}
}

/**
 * Get champion name from champion ID
 */
export async function getChampionNameById(championId: number): Promise<string> {
	const champions = await fetchChampions();

	// Find champion by key (ID)
	for (const [name, champion] of Object.entries(champions)) {
		if (parseInt(champion.key) === championId) {
			return champion.name;
		}
	}

	return `Champion ${championId}`;
}

/**
 * Get all champion IDs from cache
 * Returns champion IDs like ["Aatrox", "Ahri", "Akali", ...]
 */
export function getAllChampionIds(): string[] {
	if (!cache.champions) {
		return [];
	}
	return Object.keys(cache.champions);
}

/**
 * Get all champion names from cache
 * Returns champion display names like ["Aatrox", "Ahri", "Akali", ...]
 * Each entry includes the champion's display name from the "name" field
 */
export function getAllChampionNames(): string[] {
	if (!cache.champions) {
		return [];
	}
	return Object.values(cache.champions).map((champion) => champion.name);
}

/**
 * Interface for champion data with both ID and name
 */
export interface ChampionData {
	id: string;
	name: string;
}

/**
 * Get all champions with their IDs and names
 * Returns array of objects with id (for images) and name (for display)
 * Example: [{ id: "Aatrox", name: "Aatrox" }, { id: "MonkeyKing", name: "Wukong" }, ...]
 */
export function getAllChampions(): ChampionData[] {
	if (!cache.champions) {
		return [];
	}
	return Object.entries(cache.champions).map(([id, champion]) => ({
		id,
		name: champion.name
	}));
}

/**
 * Preload all static data including version
 * Call this on app initialization to cache all data
 */
export async function preloadStaticData(): Promise<void> {
	await Promise.all([
		fetchLatestVersion(),
		fetchQueues(),
		fetchMaps(),
		fetchGameModes(),
		fetchGameTypes(),
		fetchChampions()
	]);
}

/**
 * Format game duration from seconds to MM:SS
 */
export function formatGameDuration(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Calculate KDA ratio
 */
export function calculateKDA(kills: number, deaths: number, assists: number): string {
	if (deaths === 0) {
		return 'Perfect';
	}
	const kda = (kills + assists) / deaths;
	return kda.toFixed(2);
}

/**
 * Format large numbers with commas
 */
export function formatNumber(num: number): string {
	return num.toLocaleString();
}
