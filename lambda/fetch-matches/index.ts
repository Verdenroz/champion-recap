import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpsAgent } from 'https';
import { validateEnvironment } from '../shared/validation';
import { logger } from '../shared/logger';

/**
 * Environment Variable Validation
 * AWS Best Practice: Validate at module initialization to fail fast
 */
validateEnvironment([
	'MATCH_DATA_BUCKET',
	'PLAYER_TABLE',
	'MATCH_PROCESSING_QUEUE_URL',
	'RIOT_API_KEY'
]);

const MATCH_DATA_BUCKET = process.env.MATCH_DATA_BUCKET!;
const PLAYER_TABLE = process.env.PLAYER_TABLE!;
const MATCH_PROCESSING_QUEUE_URL = process.env.MATCH_PROCESSING_QUEUE_URL!;
const RIOT_API_KEY = process.env.RIOT_API_KEY!;

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
const sqsClient = new SQSClient({ requestHandler: httpHandler });
const lambdaClient = new LambdaClient({ requestHandler: httpHandler });

interface FetchMatchesEvent {
	gameName: string;
	tagLine: string;
	platform?: string;
	region?: string;
	year?: number;
}

/**
 * Riot API: Get account PUUID
 */
async function getAccountByRiotId(gameName: string, tagLine: string, region: string) {
	const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;

	const response = await fetch(url, {
		headers: { 'X-Riot-Token': RIOT_API_KEY }
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch account: ${response.status}`);
	}

	return response.json();
}

/**
 * Riot API: Get match IDs for a year (paginated)
 */
async function getAllMatchIdsForYear(puuid: string, region: string, year: number): Promise<string[]> {
	const startTime = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
	const endTime = Math.floor(new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000);

	const allMatchIds: string[] = [];
	let start = 0;
	const batchSize = 100;

	while (true) {
		const params = new URLSearchParams({
			startTime: startTime.toString(),
			endTime: endTime.toString(),
			start: start.toString(),
			count: batchSize.toString()
		});

		const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?${params}`;

		const response = await fetch(url, {
			headers: { 'X-Riot-Token': RIOT_API_KEY }
		});

		if (!response.ok) {
			if (response.status === 429) {
				// Rate limited, wait and retry
				await new Promise(resolve => setTimeout(resolve, 2000));
				continue;
			}
			throw new Error(`Failed to fetch match IDs: ${response.status}`);
		}

		const matchIds = await response.json() as string[];

		if (matchIds.length === 0) break;

		allMatchIds.push(...matchIds);

		if (matchIds.length < batchSize) break;

		start += batchSize;

		// Rate limiting: wait 200ms between requests
		await new Promise(resolve => setTimeout(resolve, 200));
	}

	return allMatchIds;
}

/**
 * Check if match exists in S3 for a specific player
 */
async function matchExistsInS3(matchId: string, puuid: string): Promise<boolean> {
	const key = `matches/${puuid}/${matchId}.json`;

	try {
		await s3Client.send(new HeadObjectCommand({
			Bucket: MATCH_DATA_BUCKET,
			Key: key
		}));
		return true;
	} catch {
		return false;
	}
}

/**
 * Check which matches are already cached for a specific player
 */
async function filterUncachedMatches(matchIds: string[], puuid: string): Promise<{ cached: string[], uncached: string[] }> {
	const cached: string[] = [];
	const uncached: string[] = [];

	// Check in batches of 50 to avoid throttling
	const batchSize = 50;
	for (let i = 0; i < matchIds.length; i += batchSize) {
		const batch = matchIds.slice(i, i + batchSize);

		const results = await Promise.all(
			batch.map(async (matchId) => ({
				matchId,
				exists: await matchExistsInS3(matchId, puuid)
			}))
		);

		for (const result of results) {
			if (result.exists) {
				cached.push(result.matchId);
			} else {
				uncached.push(result.matchId);
			}
		}

		// Small delay between batches
		if (i + batchSize < matchIds.length) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	return { cached, uncached };
}

/**
 * Queue matches for processing via SQS
 */
async function queueMatchesForProcessing(matchIds: string[], puuid: string, region: string, year: number) {
	// SQS batch send limit is 10 messages
	const batchSize = 10;
	let queued = 0;

	for (let i = 0; i < matchIds.length; i += batchSize) {
		const batch = matchIds.slice(i, i + batchSize);

		const entries = batch.map((matchId, index) => ({
			Id: `${matchId}-${index}`,
			MessageBody: JSON.stringify({
				matchId,
				puuid,
				region,
				year
			}),
			// Use puuid as message group ID for FIFO queue (ensures ordering per player)
			MessageGroupId: puuid,
			MessageDeduplicationId: `${matchId}-${year}`
		}));

		await sqsClient.send(new SendMessageBatchCommand({
			QueueUrl: MATCH_PROCESSING_QUEUE_URL,
			Entries: entries
		}));

		queued += batch.length;
		logger.info('Queued matches for processing', {
			queued,
			total: matchIds.length,
			puuid,
			year
		});
	}
}

/**
 * Save/Update player processing status in DynamoDB
 * AWS Best Practice: Use conditional writes to prevent race conditions
 * https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html#WorkingWithItems.ConditionalUpdate
 */
async function updatePlayerStatus(
	puuid: string,
	year: number,
	status: string,
	accountData: any,
	totalMatches: number,
	cachedMatches: number,
	queuedMatches: number
) {
	const command = new PutCommand({
		TableName: PLAYER_TABLE,
		Item: {
			puuid,
			year,
			status,
			accountData,
			totalMatches,
			cachedMatches,
			queuedMatches,
			processedMatches: cachedMatches, // Start with cached matches
			lastUpdated: new Date().toISOString(),
			ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
		},
		// Condition: Only write if item doesn't exist OR status is not already PROCESSING
		// This prevents race conditions when multiple users request the same player
		ConditionExpression: 'attribute_not_exists(puuid) OR #status <> :processing',
		ExpressionAttributeNames: {
			'#status': 'status'
		},
		ExpressionAttributeValues: {
			':processing': 'PROCESSING'
		}
	});

	try {
		await docClient.send(command);
	} catch (error: any) {
		// ConditionalCheckFailedException means the item already exists and is being processed
		if (error.name === 'ConditionalCheckFailedException') {
			logger.info('Player already being processed - concurrent request detected', {
				puuid,
				year,
				status
			});
			// This is not an error - just means another request is already processing this player
			// The caller will handle this gracefully
			throw new Error('ALREADY_PROCESSING');
		}
		throw error; // Re-throw other errors
	}
}

/**
 * Trigger initial aggregation with cached matches
 */
async function triggerInitialAggregation(puuid: string, year: number) {
	const aggregateFunctionName = process.env.AGGREGATE_STATS_FUNCTION_NAME;

	if (!aggregateFunctionName) {
		const error = new Error('AGGREGATE_STATS_FUNCTION_NAME environment variable not set');
		logger.error('Cannot trigger aggregation', error, {
			puuid,
			year
		});
		throw error; // Fail loudly - this is a critical configuration error
	}

	const command = new InvokeCommand({
		FunctionName: aggregateFunctionName,
		InvocationType: 'Event', // Async
		Payload: Buffer.from(JSON.stringify({ puuid, year }))
	});

	await lambdaClient.send(command);
	logger.info('Triggered initial aggregation', { puuid, year, functionName: aggregateFunctionName });
}

/**
 * Lambda handler
 */
export async function handler(event: FetchMatchesEvent) {
	logger.info('Fetching matches', {
		gameName: event.gameName,
		tagLine: event.tagLine,
		platform: event.platform,
		region: event.region,
		year: event.year
	});

	try {
		const {
			gameName,
			tagLine,
			platform = 'na1',
			region = 'americas',
			year = new Date().getFullYear()
		} = event;

		// Step 1: Get player PUUID
		logger.info('Fetching account from Riot API', { gameName, tagLine, region });
		const account = await getAccountByRiotId(gameName, tagLine, region) as { puuid: string };
		const puuid = account.puuid;
		logger.info('Account retrieved', { puuid, gameName, tagLine });

		// Step 2: Check if we already have recent data
		const existingData = await docClient.send(new GetCommand({
			TableName: PLAYER_TABLE,
			Key: { puuid, year }
		}));

		if (existingData.Item && existingData.Item.status === 'PROCESSING') {
			logger.info('Player already processing - allowing reconnection', {
				puuid,
				year,
				totalMatches: existingData.Item.totalMatches,
				processedMatches: existingData.Item.processedMatches
			});
			// Don't block - allow user to reconnect and see progress
			// The SSE stream will pick up the current status
			return {
				statusCode: 200,
				body: JSON.stringify({
					puuid,
					year,
					status: 'PROCESSING',
					totalMatches: existingData.Item.totalMatches,
					cachedMatches: existingData.Item.cachedMatches,
					processedMatches: existingData.Item.processedMatches,
					queuedMatches: existingData.Item.queuedMatches,
					message: 'Reconnected to existing processing session'
				})
			};
		}

		if (existingData.Item && existingData.Item.status === 'COMPLETE') {
			logger.info('Processing already complete for player', {
				puuid,
				year,
				totalMatches: existingData.Item.totalMatches
			});
			// Return the existing complete status
			return {
				statusCode: 200,
				body: JSON.stringify({
					puuid,
					year,
					status: 'COMPLETE',
					totalMatches: existingData.Item.totalMatches,
					processedMatches: existingData.Item.processedMatches,
					message: 'Processing already complete'
				})
			};
		}

		// Step 3: Get all match IDs for the year
		logger.info('Fetching match IDs from Riot API', { puuid, region, year });
		const matchIds = await getAllMatchIdsForYear(puuid, region, year);
		logger.info('Match IDs retrieved', { puuid, year, totalMatches: matchIds.length });

		// Step 4: Filter out cached matches
		logger.info('Checking S3 cache for existing matches', { puuid, totalMatches: matchIds.length });
		const { cached, uncached } = await filterUncachedMatches(matchIds, puuid);
		logger.info('Cache check complete', {
			puuid,
			year,
			cached: cached.length,
			uncached: uncached.length,
			cacheHitRate: `${((cached.length / matchIds.length) * 100).toFixed(1)}%`
		});

		// Step 5: Update player status to PROCESSING
		try {
			await updatePlayerStatus(
				puuid,
				year,
				'PROCESSING',
				account,
				matchIds.length,
				cached.length,
				uncached.length
			);
		} catch (error: any) {
			// If already processing, return the existing session info
			if (error.message === 'ALREADY_PROCESSING') {
				const existingData = await docClient.send(new GetCommand({
					TableName: PLAYER_TABLE,
					Key: { puuid, year }
				}));

				return {
					statusCode: 200,
					body: JSON.stringify({
						puuid,
						year,
						status: existingData.Item?.status || 'PROCESSING',
						totalMatches: existingData.Item?.totalMatches || matchIds.length,
						cachedMatches: existingData.Item?.cachedMatches || cached.length,
						processedMatches: existingData.Item?.processedMatches || cached.length,
						queuedMatches: existingData.Item?.queuedMatches || uncached.length,
						message: 'Reconnected to existing processing session (concurrent request)'
					})
				};
			}
			throw error; // Re-throw other errors
		}

		// Step 6: Queue uncached matches for processing
		if (uncached.length > 0) {
			logger.info('Queuing uncached matches for processing', {
				puuid,
				year,
				uncachedCount: uncached.length
			});
			await queueMatchesForProcessing(uncached, puuid, region, year);
		}

		// Step 7: Trigger initial aggregation with cached data
		if (cached.length > 0) {
			await triggerInitialAggregation(puuid, year);
		}

		return {
			statusCode: 200,
			body: JSON.stringify({
				puuid,
				year,
				status: 'PROCESSING',
				totalMatches: matchIds.length,
				cachedMatches: cached.length,
				queuedMatches: uncached.length,
				message: uncached.length === 0 ? 'All matches cached, processing complete' : 'Processing queued'
			})
		};
	} catch (error) {
		logger.error('Error fetching matches', error as Error, {
			gameName: event.gameName,
			tagLine: event.tagLine,
			platform: event.platform,
			region: event.region,
			year: event.year
		});
		return {
			statusCode: 500,
			body: JSON.stringify({
				error: 'Failed to fetch matches',
				message: error instanceof Error ? error.message : String(error)
			})
		};
	}
}
