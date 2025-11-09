import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpsAgent } from 'https';
import { validateEnvironment } from '../shared/validation';
import { logger } from '../shared/logger';
import { aggregateChampionStats } from './champion-stats';
import type { MatchDto } from './riot';

/**
 * Environment Variable Validation
 * AWS Best Practice: Validate at module initialization to fail fast
 */
validateEnvironment([
	'CHAMPION_STATS_TABLE',
	'PLAYER_TABLE',
	'MATCH_DATA_BUCKET'
]);

const CHAMPION_STATS_TABLE = process.env.CHAMPION_STATS_TABLE!;
const PLAYER_TABLE = process.env.PLAYER_TABLE!;
const MATCH_DATA_BUCKET = process.env.MATCH_DATA_BUCKET!;
const COACHING_AGENT_FUNCTION = process.env.COACHING_AGENT_FUNCTION;
const COACHING_SESSIONS_TABLE = process.env.COACHING_SESSIONS_TABLE; // Optional: for coaching integration

/**
 * HTTP Handler with Keep-Alive for Connection Reuse
 * AWS Best Practice: Reuse connections to reduce latency
 */
const httpHandler = new NodeHttpHandler({
	connectionTimeout: 3000,
	socketTimeout: 3000,
	httpsAgent: new HttpsAgent({
		keepAlive: true,
		maxSockets: 50,
		keepAliveMsecs: 1000
	})
});

const dynamoClient = new DynamoDBClient({ requestHandler: httpHandler });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ requestHandler: httpHandler });
const lambdaClient = new LambdaClient({ requestHandler: httpHandler });

interface AggregateStatsEvent {
	puuid: string;
	year: number;
	matchIds?: string[]; // Optional: specific matches to process
	sessionId?: string; // Optional: coaching session ID
	connectionId?: string; // Optional: WebSocket connection ID for coaching
}

/**
 * Fetch match data from S3
 */
async function fetchMatchFromS3(matchId: string, puuid: string): Promise<MatchDto> {
	const key = `matches/${puuid}/${matchId}.json`;
	const command = new GetObjectCommand({
		Bucket: MATCH_DATA_BUCKET,
		Key: key
	});

	const response = await s3Client.send(command);
	const body = await response.Body!.transformToString();
	return JSON.parse(body);
}

/**
 * Get all match IDs from S3 for a specific player
 */
async function getPlayerMatchIdsFromS3(puuid: string): Promise<string[]> {
	const matchIds: string[] = [];
	let continuationToken: string | undefined;

	do {
		const command = new ListObjectsV2Command({
			Bucket: MATCH_DATA_BUCKET,
			Prefix: `matches/${puuid}/`,
			ContinuationToken: continuationToken
		});

		const response = await s3Client.send(command);

		if (response.Contents) {
			for (const object of response.Contents) {
				if (object.Key) {
					// Extract match ID from key: matches/{puuid}/NA1_1234567890.json -> NA1_1234567890
					const parts = object.Key.split('/');
					const matchId = parts[parts.length - 1].replace('.json', '');
					matchIds.push(matchId);
				}
			}
		}

		continuationToken = response.NextContinuationToken;
	} while (continuationToken);

	return matchIds;
}

/**
 * Save champion statistics to DynamoDB with idempotency check
 * Uses version tracking to prevent duplicate aggregations
 */
async function saveChampionStats(puuid: string, year: number, stats: any, matchCount: number) {
	// First, try to get existing record to check version
	const getCommand = new GetCommand({
		TableName: CHAMPION_STATS_TABLE,
		Key: { puuid, year }
	});

	const existing = await docClient.send(getCommand);
	const currentVersion = existing.Item?.version || 0;
	const newVersion = currentVersion + 1;

	// Calculate a hash based on match count to detect changes
	const statsHash = `${matchCount}-${year}`;

	// Only update if the hash has changed (prevents re-aggregating same data)
	if (existing.Item && existing.Item.statsHash === statsHash) {
		logger.info('Stats unchanged, skipping update', {
			puuid,
			year,
			matchCount,
			currentVersion
		});
		return;
	}

	const putCommand = new PutCommand({
		TableName: CHAMPION_STATS_TABLE,
		Item: {
			puuid,
			year,
			stats,
			version: newVersion,
			statsHash,
			lastUpdated: new Date().toISOString(),
			ttl: Math.floor(Date.now() / 1000) + 86400 * 7 // 7 days TTL
		}
	});

	await docClient.send(putCommand);
	logger.info('Champion stats saved', {
		puuid,
		year,
		version: newVersion,
		matchCount
	});
}

/**
 * Query for active coaching session by puuid
 * Returns the most recent active session if one exists
 */
async function getActiveCoachingSession(puuid: string): Promise<string | null> {
	if (!COACHING_SESSIONS_TABLE) {
		return null;
	}

	try {
		const command = new QueryCommand({
			TableName: COACHING_SESSIONS_TABLE,
			IndexName: 'PuuidIndex',
			KeyConditionExpression: 'puuid = :puuid',
			ExpressionAttributeValues: {
				':puuid': puuid,
				':active': 'ACTIVE'
			},
			FilterExpression: '#status = :active',
			ExpressionAttributeNames: {
				'#status': 'status'
			},
			ScanIndexForward: false, // Most recent first
			Limit: 1
		});

		const result = await docClient.send(command);

		if (result.Items && result.Items.length > 0) {
			const session = result.Items[0];
			logger.info('Found active coaching session', {
				sessionId: session.session_id,
				puuid
			});
			return session.session_id as string;
		}

		logger.info('No active coaching session found', { puuid });
		return null;
	} catch (error) {
		logger.error('Error querying coaching sessions', error as Error, { puuid });
		return null;
	}
}

/**
 * Get coaching session details including last_match_index_sent
 */
async function getCoachingSessionDetails(sessionId: string): Promise<any | null> {
	if (!COACHING_SESSIONS_TABLE) {
		return null;
	}

	try {
		const command = new GetCommand({
			TableName: COACHING_SESSIONS_TABLE,
			Key: { session_id: sessionId }
		});

		const result = await docClient.send(command);
		return result.Item || null;
	} catch (error) {
		logger.error('Error getting coaching session details', error as Error, { sessionId });
		return null;
	}
}

/**
 * Invoke coaching agent orchestrator with NEW matches for session analysis
 * Only sends matches that haven't been sent yet (from last_match_index_sent onwards)
 */
async function invokeCoachingAgent(
	sessionId: string,
	puuid: string,
	topChampion: string,
	matches: MatchDto[],
	lastMatchIndexSent: number,
	connectionId?: string
) {
	if (!COACHING_AGENT_FUNCTION) {
		logger.info('Coaching agent function not configured, skipping coaching invocation');
		return;
	}

	logger.info('Invoking coaching agent orchestrator', {
		sessionId,
		puuid,
		topChampion,
		totalMatches: matches.length,
		lastMatchIndexSent,
		newMatchesCount: matches.length - lastMatchIndexSent
	});

	// Only send NEW matches (from lastMatchIndexSent onwards)
	const newMatches = matches.slice(lastMatchIndexSent);

	if (newMatches.length === 0) {
		logger.info('No new matches to send to coaching agent', {
			sessionId,
			totalMatches: matches.length,
			lastMatchIndexSent
		});
		return;
	}

	logger.info('Sending new matches to coaching agent', {
		sessionId,
		newMatchesCount: newMatches.length,
		fromIndex: lastMatchIndexSent,
		toIndex: matches.length - 1
	});

	// Extract match data for NEW matches with comprehensive stats for strategic coaching
	const matchDataArray = newMatches.map((match) => {
		const participant = match.info.participants.find(p => p.puuid === puuid);
		if (!participant) {
			logger.warn('Player not found in match', {
				matchId: match.metadata.matchId,
				puuid
			});
			return null;
		}

		// Calculate CS per minute
		const durationMinutes = match.info.gameDuration / 60;
		const csPerMin = durationMinutes > 0 ? participant.totalMinionsKilled / durationMinutes : 0;

		// Calculate team damage percentage
		const teamParticipants = match.info.participants.filter(p => p.teamId === participant.teamId);
		const teamTotalDamage = teamParticipants.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0);
		const teamDamagePercentage = teamTotalDamage > 0 ? participant.totalDamageDealtToChampions / teamTotalDamage : 0;

		// Extract strategic coaching fields from challenges
		const challenges = participant.challenges || {};

		return {
			// Basic info
			championName: participant.championName,
			championId: participant.championId,
			kills: participant.kills,
			deaths: participant.deaths,
			assists: participant.assists,
			win: participant.win,
			position: participant.teamPosition,

			// CS and gold
			totalMinionsKilled: participant.totalMinionsKilled,
			csPerMin: csPerMin,
			goldEarned: participant.goldEarned,

			// Vision control
			visionScore: participant.visionScore,
			wardsPlaced: participant.wardsPlaced,
			wardsKilled: participant.wardsKilled,
			visionWardsBoughtInGame: participant.visionWardsBoughtInGame,

			// Combat stats
			totalDamageDealtToChampions: participant.totalDamageDealtToChampions,
			totalDamageTaken: participant.totalDamageTaken,
			teamDamagePercentage: teamDamagePercentage,

			// Objectives
			baronKills: participant.baronKills,
			dragonKills: participant.dragonKills,
			turretKills: participant.turretKills,
			firstBloodKill: participant.firstBloodKill,

			// Strategic coaching fields from challenges
			// Early game performance
			laneMinionsFirst10Minutes: challenges.laneMinionsFirst10Minutes ?? null,
			jungleCsBefore10Minutes: challenges.jungleCsBefore10Minutes ?? null,

			// Objective timing and participation
			earliestDragonTakedown: challenges.earliestDragonTakedown ?? null,
			earliestBaron: challenges.earliestBaron ?? null,
			turretTakedowns: challenges.turretTakedowns ?? null,
			epicMonsterSteals: challenges.epicMonsterSteals ?? null,
			teamElderDragonKills: challenges.teamElderDragonKills ?? null,

			// Vision patterns
			visionScorePerMinute: challenges.visionScorePerMinute ?? null,
			controlWardsPlaced: challenges.controlWardsPlaced ?? null,
			wardsGuarded: challenges.wardsGuarded ?? null,
			stealthWardsPlaced: challenges.stealthWardsPlaced ?? null,

			// Combat effectiveness
			damagePerMinute: challenges.damagePerMinute ?? null,
			goldPerMinute: challenges.goldPerMinute ?? null,
			killParticipation: challenges.killParticipation ?? null,
			skillshotsHit: challenges.skillshotsHit ?? null,
			skillshotsDodged: challenges.skillshotsDodged ?? null,
			dodgeSkillShotsSmallWindow: challenges.dodgeSkillShotsSmallWindow ?? null,

			// Team fighting
			damageTakenOnTeamPercentage: challenges.damageTakenOnTeamPercentage ?? null,
			soloKills: challenges.soloKills ?? null,
			multikills: challenges.multikills ?? null,
			perfectGame: challenges.perfectGame ?? null,

			// Map control
			junglerKillsEarlyJungle: challenges.junglerKillsEarlyJungle ?? null,
			enemyJungleMonsterKills: challenges.enemyJungleMonsterKills ?? null,
			scuttleCrabKills: challenges.scuttleCrabKills ?? null,

			// Full challenges object for additional analysis
			challenges: participant.challenges
		};
	}).filter(m => m !== null); // Remove any matches where player wasn't found

	// Invoke orchestrator with NEW matches and index tracking
	const payload = {
		session_id: sessionId,
		summoner_id: puuid,
		top_champion: topChampion,
		matches: matchDataArray,
		last_match_index_sent: lastMatchIndexSent,  // Index before sending these matches
		new_last_match_index: matches.length,  // Index after processing (total matches processed)
		connection_id: connectionId
	};

	try {
		const command = new InvokeCommand({
			FunctionName: COACHING_AGENT_FUNCTION,
			InvocationType: 'Event', // Async invocation
			Payload: JSON.stringify(payload)
		});

		await lambdaClient.send(command);
		logger.info('Coaching agent orchestrator invoked successfully', {
			sessionId,
			matchCount: matchDataArray.length
		});
	} catch (err) {
		logger.error('Failed to invoke coaching agent orchestrator', err as Error, {
			sessionId,
			matchCount: matchDataArray.length
		});
		throw err;
	}
}

/**
 * Lambda handler
 */
export async function handler(event: AggregateStatsEvent) {
	logger.info('Aggregating stats', {
		puuid: event.puuid,
		year: event.year,
		sessionId: event.sessionId,
		connectionId: event.connectionId
	});

	try {
		const { puuid, year } = event;

		// Get all match IDs from S3 for this player
		const matchIds = await getPlayerMatchIdsFromS3(puuid);

		if (matchIds.length === 0) {
			logger.info('No matches found in S3 for player', { puuid, year });
			return {
				statusCode: 404,
				body: JSON.stringify({ error: 'No matches found' })
			};
		}

		logger.info('Found matches for player', {
			puuid,
			year,
			matchCount: matchIds.length
		});

		// Fetch matches from S3 in parallel (batches of 50)
		const matches: MatchDto[] = [];
		const batchSize = 50;

		for (let i = 0; i < matchIds.length; i += batchSize) {
			const batch = matchIds.slice(i, i + batchSize);
			const batchMatches = await Promise.all(
				batch.map(matchId =>
					fetchMatchFromS3(matchId, puuid).catch(err => {
						logger.error('Failed to fetch match from S3', err as Error, {
							matchId,
							puuid
						});
						return null;
					})
				)
			);

			matches.push(...batchMatches.filter(m => m !== null) as MatchDto[]);
			logger.info('Fetched match batch', {
				puuid,
				fetchedCount: matches.length,
				totalCount: matchIds.length,
				percentComplete: `${((matches.length / matchIds.length) * 100).toFixed(1)}%`
			});
		}

		// Aggregate champion statistics
		logger.info('Aggregating champion statistics', {
			puuid,
			year,
			matchCount: matches.length
		});
		const championRecap = aggregateChampionStats(matches, puuid);

		// Include recent match history for op.gg-style display
		const recentMatches = matches.slice(0, 20).map(match => {
			const participant = match.info.participants.find(p => p.puuid === puuid);
			if (!participant) return null;

			// Get team and enemy champions
			const playerTeamId = participant.teamId;
			const teamChampions: number[] = [];
			const enemyChampions: number[] = [];

			for (const p of match.info.participants) {
				if (p.puuid === puuid) continue; // Skip the player

				if (p.teamId === playerTeamId) {
					teamChampions.push(p.championId);
				} else {
					enemyChampions.push(p.championId);
				}
			}

			return {
				matchId: match.metadata.matchId,
				gameCreation: match.info.gameCreation,
				gameDuration: match.info.gameDuration,
				gameMode: match.info.gameMode,
				queueId: match.info.queueId,
				championName: participant.championName,
				championId: participant.championId,
				kills: participant.kills,
				deaths: participant.deaths,
				assists: participant.assists,
				totalMinionsKilled: participant.totalMinionsKilled,
				visionScore: participant.visionScore,
				win: participant.win,
				position: participant.teamPosition,
				items: [
					participant.item0,
					participant.item1,
					participant.item2,
					participant.item3,
					participant.item4,
					participant.item5,
					participant.item6
				],
				summoner1Id: participant.summoner1Id,
				summoner2Id: participant.summoner2Id,
				teamChampions,
				enemyChampions
			};
		}).filter(m => m !== null);

		// Add match history to championRecap
		(championRecap as any).matchHistory = recentMatches;

		// Save to DynamoDB (with idempotency check)
		await saveChampionStats(puuid, year, championRecap, matches.length);

		// Check for coaching session - either from event or query active session
		let sessionId = event.sessionId;
		if (!sessionId) {
			sessionId = await getActiveCoachingSession(puuid) || undefined;
		}

		// Invoke coaching agent if session exists and we have champion data
		if (sessionId && championRecap.top3Champions.length > 0) {
			// Get session details to determine which matches to send and champion personality
			const sessionDetails = await getCoachingSessionDetails(sessionId);
			const lastMatchIndexSent = sessionDetails?.last_match_index_sent || 0;

			// Use session's champion_personality (source of truth) instead of aggregated top champion
			// This ensures consistent voice personality throughout the coaching session
			let championPersonality = sessionDetails?.champion_personality;

			if (!championPersonality) {
				// Fallback to aggregated top champion if session doesn't have personality set
				championPersonality = championRecap.top3Champions[0].championName;
				logger.warn('Session missing champion_personality, using aggregated top champion', {
					sessionId,
					fallbackChampion: championPersonality,
					puuid
				});
			}

			logger.info('Starting coaching session', {
				sessionId,
				championPersonality,
				puuid,
				matchCount: matches.length,
				lastMatchIndexSent,
				newMatchesCount: matches.length - lastMatchIndexSent
			});

			// Invoke coaching agent asynchronously (don't wait for completion)
			// Only sends NEW matches from lastMatchIndexSent onwards
			invokeCoachingAgent(
				sessionId,
				puuid,
				championPersonality,
				matches,
				lastMatchIndexSent,
				event.connectionId
			).catch(err => {
				logger.error('Error invoking coaching agent', err as Error, {
					sessionId,
					puuid
				});
			});
		}

		return {
			statusCode: 200,
			body: JSON.stringify({
				puuid,
				year,
				matchesProcessed: matches.length,
				recap: championRecap
			})
		};
	} catch (error) {
		const { puuid, year } = event;
		logger.error('Error aggregating stats', error as Error, {
			puuid,
			year
		});

		// Mark player status as ERROR to allow retry
		try {
			const updateCommand = new UpdateCommand({
				TableName: PLAYER_TABLE,
				Key: { puuid, year },
				UpdateExpression: 'SET #status = :status, error_message = :error, lastUpdated = :now',
				ExpressionAttributeNames: {
					'#status': 'status'
				},
				ExpressionAttributeValues: {
					':status': 'ERROR',
					':error': (error as Error).message || 'Unknown error during aggregation',
					':now': new Date().toISOString()
				}
			});

			await docClient.send(updateCommand);
			logger.info('Marked player status as ERROR', { puuid, year });
		} catch (updateError) {
			logger.error('Failed to update player status to ERROR', updateError as Error, {
				puuid,
				year
			});
		}

		return {
			statusCode: 500,
			body: JSON.stringify({
				error: 'Failed to aggregate stats',
				puuid,
				year
			})
		};
	}
}
