import type { MatchDto, ParticipantDto } from './types/riot';

/**
 * Champion statistics types
 */
export interface ChampionPlayStats {
	championId: number;
	championName: string;
	gamesPlayed: number;
	wins: number;
	losses: number;
	winRate: number;
}

export interface TeammateChampionStats {
	championId: number;
	championName: string;
	role: string;
	gamesPlayedWith: number;
	wins: number;
	winRate: number;
}

export interface EnemyChampionStats {
	championId: number;
	championName: string;
	role: string;
	gamesAgainst: number;
	losses: number;
	lossRate: number;
}

export interface ChampionRecap {
	top3Champions: ChampionPlayStats[];
	favoriteChampions: TeammateChampionStats[]; // One per role
	nemesisChampions: EnemyChampionStats[]; // Top 3 across all roles (your lane only)
	hatedChampions: EnemyChampionStats[]; // One per role
}

/**
 * Extract player's position in a match
 */
function getPlayerPosition(participant: ParticipantDto): string {
	let position = participant.teamPosition || participant.individualPosition || 'SUPPORT';

	// Handle empty strings
	if (!position || position.trim() === '') {
		position = 'SUPPORT';
	}

	// Map UTILITY to SUPPORT for better readability
	return position === 'UTILITY' ? 'SUPPORT' : position;
}

/**
 * Check if a position is valid (not Invalid or empty)
 */
function isValidPosition(position: string): boolean {
	return !!(position && position.toUpperCase() !== 'INVALID');
}

/**
 * Find opponent in the same lane
 */
function findLaneOpponent(
	playerParticipant: ParticipantDto,
	allParticipants: ParticipantDto[]
): ParticipantDto | null {
	const playerPosition = getPlayerPosition(playerParticipant);
	const playerTeamId = playerParticipant.teamId;

	// Find enemy team participant with same position
	const opponent = allParticipants.find(
		(p) =>
			p.teamId !== playerTeamId &&
			getPlayerPosition(p) === playerPosition &&
			p.participantId !== playerParticipant.participantId
	);

	return opponent || null;
}

/**
 * Analyze a single match to extract champion statistics
 */
export function analyzeMatch(match: MatchDto, playerPuuid: string) {
	const player = match.info.participants.find((p) => p.puuid === playerPuuid);
	if (!player) {
		throw new Error('Player not found in match');
	}

	const playerTeamId = player.teamId;
	const playerWon = player.win;
	const playerPosition = getPlayerPosition(player);

	// Get teammates (excluding the player)
	const teammates = match.info.participants.filter(
		(p) => p.teamId === playerTeamId && p.puuid !== playerPuuid
	);

	// Get enemies
	const enemies = match.info.participants.filter((p) => p.teamId !== playerTeamId);

	// Find lane opponent (for nemesis calculation)
	const laneOpponent = findLaneOpponent(player, match.info.participants);

	return {
		// Player's champion
		playerChampion: {
			championId: player.championId,
			championName: player.championName,
			won: playerWon,
			position: playerPosition
		},

		// Teammates' champions (for favorites)
		teammates: teammates.map((t) => ({
			championId: t.championId,
			championName: t.championName,
			role: getPlayerPosition(t),
			won: playerWon
		})),

		// Lane opponent (for nemesis)
		laneOpponent: laneOpponent
			? {
					championId: laneOpponent.championId,
					championName: laneOpponent.championName,
					role: getPlayerPosition(laneOpponent),
					lost: !playerWon
				}
			: null,

		// All enemies (for hated champions)
		enemies: enemies.map((e) => ({
			championId: e.championId,
			championName: e.championName,
			role: getPlayerPosition(e),
			lost: !playerWon
		}))
	};
}

/**
 * Aggregate champion statistics across all matches
 */
export function aggregateChampionStats(matches: MatchDto[], playerPuuid: string): ChampionRecap {
	// Track player's champion usage
	const playerChampionMap = new Map<
		number,
		{ name: string; wins: number; losses: number; total: number }
	>();

	// Track teammate champions by role
	const teammateChampionMap = new Map<
		string,
		{ championId: number; name: string; wins: number; total: number }
	>();

	// Track lane opponents (for nemesis)
	const laneOpponentMap = new Map<
		number,
		{ name: string; role: string; losses: number; total: number }
	>();

	// Track all enemies by role
	const enemyChampionMap = new Map<
		string,
		{ championId: number; name: string; losses: number; total: number }
	>();

	// Analyze each match
	for (const match of matches) {
		try {
			const analysis = analyzeMatch(match, playerPuuid);

			// Update player champion stats
			const playerChamp = playerChampionMap.get(analysis.playerChampion.championId) || {
				name: analysis.playerChampion.championName,
				wins: 0,
				losses: 0,
				total: 0
			};
			if (analysis.playerChampion.won) {
				playerChamp.wins++;
			} else {
				playerChamp.losses++;
			}
			playerChamp.total++;
			playerChampionMap.set(analysis.playerChampion.championId, playerChamp);

			// Update teammate champion stats (skip Invalid positions)
			for (const teammate of analysis.teammates) {
				if (!isValidPosition(teammate.role)) continue;

				const key = `${teammate.championId}-${teammate.role}`;
				const stats = teammateChampionMap.get(key) || {
					championId: teammate.championId,
					name: teammate.championName,
					wins: 0,
					total: 0
				};
				if (teammate.won) stats.wins++;
				stats.total++;
				teammateChampionMap.set(key, stats);
			}

			// Update lane opponent stats (nemesis)
			if (analysis.laneOpponent) {
				const stats = laneOpponentMap.get(analysis.laneOpponent.championId) || {
					name: analysis.laneOpponent.championName,
					role: analysis.laneOpponent.role,
					losses: 0,
					total: 0
				};
				if (analysis.laneOpponent.lost) stats.losses++;
				stats.total++;
				laneOpponentMap.set(analysis.laneOpponent.championId, stats);
			}

			// Update enemy champion stats (skip Invalid positions)
			for (const enemy of analysis.enemies) {
				if (!isValidPosition(enemy.role)) continue;

				const key = `${enemy.championId}-${enemy.role}`;
				const stats = enemyChampionMap.get(key) || {
					championId: enemy.championId,
					name: enemy.championName,
					losses: 0,
					total: 0
				};
				if (enemy.lost) stats.losses++;
				stats.total++;
				enemyChampionMap.set(key, stats);
			}
		} catch (error) {
			console.error('Error analyzing match:', error);
			// Continue with next match
		}
	}

	// Compute Top 3 Champions
	const top3Champions = Array.from(playerChampionMap.entries())
		.map(([championId, stats]) => ({
			championId,
			championName: stats.name,
			gamesPlayed: stats.total,
			wins: stats.wins,
			losses: stats.losses,
			winRate: stats.total > 0 ? stats.wins / stats.total : 0
		}))
		.sort((a, b) => b.gamesPlayed - a.gamesPlayed)
		.slice(0, 3);

	// Compute Favorite Champions (one per role)
	const roleGroups = new Map<string, TeammateChampionStats[]>();
	for (const [key, stats] of teammateChampionMap.entries()) {
		const role = key.split('-')[1];
		const championStats: TeammateChampionStats = {
			championId: stats.championId,
			championName: stats.name,
			role,
			gamesPlayedWith: stats.total,
			wins: stats.wins,
			winRate: stats.total > 0 ? stats.wins / stats.total : 0
		};

		if (!roleGroups.has(role)) {
			roleGroups.set(role, []);
		}
		roleGroups.get(role)!.push(championStats);
	}

	const favoriteChampions: TeammateChampionStats[] = [];
	for (const [role, champions] of roleGroups.entries()) {
		// Sort by win rate, then by games played
		const bestChampion = champions
			.filter((c) => c.gamesPlayedWith >= 3) // Minimum 3 games
			.sort((a, b) => {
				if (Math.abs(b.winRate - a.winRate) > 0.01) {
					return b.winRate - a.winRate;
				}
				return b.gamesPlayedWith - a.gamesPlayedWith;
			})[0];

		if (bestChampion) {
			favoriteChampions.push(bestChampion);
		}
	}

	// Compute Nemesis Champions (top 3 lane opponents you lost to most)
	const nemesisChampions = Array.from(laneOpponentMap.entries())
		.map(([championId, stats]) => ({
			championId,
			championName: stats.name,
			role: stats.role,
			gamesAgainst: stats.total,
			losses: stats.losses,
			lossRate: stats.total > 0 ? stats.losses / stats.total : 0
		}))
		.filter((c) => c.gamesAgainst >= 3) // Minimum 3 games
		.sort((a, b) => {
			// Sort by total losses first, then by loss rate
			if (b.losses !== a.losses) {
				return b.losses - a.losses;
			}
			return b.lossRate - a.lossRate;
		})
		.slice(0, 3);

	// Compute Hated Champions (one per role)
	const enemyRoleGroups = new Map<string, EnemyChampionStats[]>();
	for (const [key, stats] of enemyChampionMap.entries()) {
		const role = key.split('-')[1];
		const championStats: EnemyChampionStats = {
			championId: stats.championId,
			championName: stats.name,
			role,
			gamesAgainst: stats.total,
			losses: stats.losses,
			lossRate: stats.total > 0 ? stats.losses / stats.total : 0
		};

		if (!enemyRoleGroups.has(role)) {
			enemyRoleGroups.set(role, []);
		}
		enemyRoleGroups.get(role)!.push(championStats);
	}

	const hatedChampions: EnemyChampionStats[] = [];
	for (const [role, champions] of enemyRoleGroups.entries()) {
		// Sort by total losses, then by loss rate
		const worstChampion = champions
			.filter((c) => c.gamesAgainst >= 3) // Minimum 3 games
			.sort((a, b) => {
				if (b.losses !== a.losses) {
					return b.losses - a.losses;
				}
				return b.lossRate - a.lossRate;
			})[0];

		if (worstChampion) {
			hatedChampions.push(worstChampion);
		}
	}

	return {
		top3Champions,
		favoriteChampions,
		nemesisChampions,
		hatedChampions
	};
}

/**
 * Process matches progressively and yield statistics as they're computed
 */
export async function* processMatchesProgressive(
	matches: MatchDto[],
	playerPuuid: string,
	batchSize: number = 50
) {
	let processedMatches: MatchDto[] = [];

	for (let i = 0; i < matches.length; i += batchSize) {
		const batch = matches.slice(i, Math.min(i + batchSize, matches.length));
		processedMatches.push(...batch);

		// Compute stats with all processed matches so far
		const stats = aggregateChampionStats(processedMatches, playerPuuid);

		yield {
			progress: {
				current: processedMatches.length,
				total: matches.length
			},
			stats
		};
	}
}
