import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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
 * Invoke coaching agent for match-by-match analysis
 */
async function invokeCoachingAgent(
	sessionId: string,
	puuid: string,
	topChampion: string,
	matches: MatchDto[],
	connectionId?: string
) {
	if (!COACHING_AGENT_FUNCTION) {
		logger.info('Coaching agent function not configured, skipping coaching invocation');
		return;
	}

	logger.info('Invoking coaching agent', {
		sessionId,
		puuid,
		topChampion,
		matchCount: matches.length
	});

	// Invoke coaching agent asynchronously for each match
	const invocations = matches.map(async (match, index) => {
		try {
			// Extract player's participation from match
			const participant = match.info.participants.find(p => p.puuid === puuid);
			if (!participant) {
				logger.warn('Player not found in match', {
					matchId: match.metadata.matchId,
					puuid
				});
				return;
			}

			const matchData = {
				gameId: match.metadata.matchId,
				championName: participant.championName,
				championId: participant.championId,
				kills: participant.kills,
				deaths: participant.deaths,
				assists: participant.assists,
				totalMinionsKilled: participant.totalMinionsKilled,
				visionScore: participant.visionScore,
				goldEarned: participant.goldEarned,
				damageDealt: participant.totalDamageDealtToChampions,
				duration: match.info.gameDuration,
				win: participant.win,
				position: participant.teamPosition
			};

			const payload = {
				session_id: sessionId,
				summoner_id: puuid,
				top_champion: topChampion,
				match_data: matchData,
				match_number: index + 1,
				total_matches: matches.length,
				connection_id: connectionId
			};

			const command = new InvokeCommand({
				FunctionName: COACHING_AGENT_FUNCTION,
				InvocationType: 'Event', // Async invocation
				Payload: JSON.stringify(payload)
			});

			await lambdaClient.send(command);
			logger.info('Coaching agent invoked for match', {
				matchNumber: index + 1,
				totalMatches: matches.length,
				matchId: match.metadata.matchId
			});
		} catch (err) {
			logger.error('Failed to invoke coaching agent for match', err as Error, {
				matchNumber: index + 1,
				matchId: match.metadata.matchId
			});
		}
	});

	// Execute all invocations (they're async, so this just queues them)
	await Promise.allSettled(invocations);
	logger.info('All coaching agent invocations queued', {
		sessionId,
		totalMatches: matches.length
	});
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

		// Save to DynamoDB (with idempotency check)
		await saveChampionStats(puuid, year, championRecap, matches.length);

		// Invoke coaching agent if session info provided
		if (event.sessionId && championRecap.stats.top3Champions.length > 0) {
			const topChampion = championRecap.stats.top3Champions[0].championName;
			logger.info('Starting coaching session', {
				sessionId: event.sessionId,
				topChampion,
				puuid,
				matchCount: matches.length
			});

			// Invoke coaching agent asynchronously (don't wait for completion)
			invokeCoachingAgent(
				event.sessionId,
				puuid,
				topChampion,
				matches,
				event.connectionId
			).catch(err => {
				logger.error('Error invoking coaching agent', err as Error, {
					sessionId: event.sessionId,
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
		logger.error('Error aggregating stats', error as Error, {
			puuid: event.puuid,
			year: event.year
		});
		return {
			statusCode: 500,
			body: JSON.stringify({ error: 'Failed to aggregate stats' })
		};
	}
}
