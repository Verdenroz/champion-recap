import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpsAgent } from 'https';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { validateEnvironment } from '../shared/validation';
import { logger } from '../shared/logger';

/**
 * Environment Variable Validation
 * AWS Best Practice: Validate at module initialization to fail fast
 */
validateEnvironment([
	'MATCH_DATA_BUCKET',
	'PLAYER_TABLE',
	'RIOT_API_KEY'
]);

const MATCH_DATA_BUCKET = process.env.MATCH_DATA_BUCKET!;
const PLAYER_TABLE = process.env.PLAYER_TABLE!;
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
const lambdaClient = new LambdaClient({ requestHandler: httpHandler });

interface MatchMessage {
	matchId: string;
	puuid: string;
	region: string;
	year: number;
}

/**
 * Riot API: Get match details with retry logic
 */
async function getMatchById(matchId: string, region: string, maxRetries = 3): Promise<any> {
	const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const response = await fetch(url, {
				headers: { 'X-Riot-Token': RIOT_API_KEY }
			});

			if (response.ok) {
				return await response.json();
			}

			if (response.status === 429) {
				// Rate limited
				const retryAfter = parseInt(response.headers.get('Retry-After') || '2');
				logger.warn('Rate limited by Riot API', {
					matchId,
					region,
					retryAfter,
					attempt,
					maxRetries
				});
				await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
				continue;
			}

			if (response.status === 404) {
				// Match not found, skip it
				logger.info('Match not found (404)', { matchId, region });
				return null;
			}

			throw new Error(`Failed to fetch match: ${response.status}`);
		} catch (error) {
			if (attempt === maxRetries) {
				throw error;
			}
			logger.warn('Retry attempt failed', {
				matchId,
				region,
				attempt,
				maxRetries,
				error: error instanceof Error ? error.message : String(error)
			});
			await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
		}
	}
}

/**
 * Save match data to S3 (player-specific path)
 */
async function saveMatchToS3(matchId: string, matchData: any, puuid: string) {
	const key = `matches/${puuid}/${matchId}.json`;
	const command = new PutObjectCommand({
		Bucket: MATCH_DATA_BUCKET,
		Key: key,
		Body: JSON.stringify(matchData),
		ContentType: 'application/json'
	});

	await s3Client.send(command);
}

/**
 * Increment processed matches counter in DynamoDB
 */
async function incrementProcessedMatches(puuid: string, year: number): Promise<number> {
	const command = new UpdateCommand({
		TableName: PLAYER_TABLE,
		Key: { puuid, year },
		UpdateExpression: 'SET processedMatches = processedMatches + :inc, lastUpdated = :now',
		ExpressionAttributeValues: {
			':inc': 1,
			':now': new Date().toISOString()
		},
		ReturnValues: 'ALL_NEW'
	});

	const result = await docClient.send(command);
	return result.Attributes?.processedMatches || 0;
}

/**
 * Check if we should trigger aggregation
 */
async function shouldTriggerAggregation(puuid: string, year: number, processedMatches: number): Promise<boolean> {
	// Trigger every 20 matches or when complete
	if (processedMatches % 20 !== 0) {
		return false;
	}

	// Check if we're done processing
	const result = await docClient.send(new GetCommand({
		TableName: PLAYER_TABLE,
		Key: { puuid, year }
	}));

	const playerData = result.Item;
	if (!playerData) return false;

	const total = playerData.totalMatches || 0;
	const processed = playerData.processedMatches || 0;

	logger.info('Match processing progress', {
		puuid,
		year,
		processed,
		total,
		percentComplete: `${((processed / total) * 100).toFixed(1)}%`
	});

	return true;
}

/**
 * Trigger aggregation Lambda
 */
async function triggerAggregation(puuid: string, year: number) {
	const aggregateFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME?.replace('process-match', 'aggregate-stats');

	if (!aggregateFunctionName) {
		logger.error('Could not determine aggregate function name', new Error('AWS_LAMBDA_FUNCTION_NAME not set or invalid'), {
			currentFunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME
		});
		return;
	}

	const command = new InvokeCommand({
		FunctionName: aggregateFunctionName,
		InvocationType: 'Event', // Async
		Payload: Buffer.from(JSON.stringify({ puuid, year }))
	});

	await lambdaClient.send(command);
	logger.info('Triggered aggregation', { puuid, year, functionName: aggregateFunctionName });
}

/**
 * Update player status to COMPLETE
 */
async function markPlayerComplete(puuid: string, year: number) {
	const command = new UpdateCommand({
		TableName: PLAYER_TABLE,
		Key: { puuid, year },
		UpdateExpression: 'SET #status = :status, lastUpdated = :now',
		ExpressionAttributeNames: {
			'#status': 'status'
		},
		ExpressionAttributeValues: {
			':status': 'COMPLETE',
			':now': new Date().toISOString()
		}
	});

	await docClient.send(command);
	logger.info('Marked player as COMPLETE', { puuid, year });
}

/**
 * Process a single SQS record
 */
async function processRecord(record: SQSRecord) {
	const message: MatchMessage = JSON.parse(record.body);
	const { matchId, puuid, region, year } = message;

	logger.info('Processing match', { matchId, puuid, region, year });

	try {
		// Fetch match data from Riot API
		const matchData = await getMatchById(matchId, region);

		if (!matchData) {
			// Match not found, just increment counter
			logger.info('Skipping match (not found)', { matchId, puuid });
			await incrementProcessedMatches(puuid, year);
			return;
		}

		// Save to S3
		await saveMatchToS3(matchId, matchData, puuid);

		// Increment processed counter
		const processedMatches = await incrementProcessedMatches(puuid, year);

		// Check if we should trigger aggregation
		if (await shouldTriggerAggregation(puuid, year, processedMatches)) {
			await triggerAggregation(puuid, year);
		}

		// Check if all matches are processed
		const playerData = await docClient.send(new GetCommand({
			TableName: PLAYER_TABLE,
			Key: { puuid, year }
		}));

		if (playerData.Item) {
			const total = playerData.Item.totalMatches || 0;
			const processed = playerData.Item.processedMatches || 0;

			if (processed >= total && playerData.Item.status === 'PROCESSING') {
				await markPlayerComplete(puuid, year);
				await triggerAggregation(puuid, year); // Final aggregation
			}
		}

		logger.info('Successfully processed match', { matchId, puuid, year });
	} catch (error) {
		logger.error('Failed to process match', error as Error, { matchId, puuid, region, year });
		throw error; // Let SQS retry
	}
}

/**
 * Lambda handler for SQS events
 */
export async function handler(event: SQSEvent) {
	logger.info('Processing SQS batch', { messageCount: event.Records.length });

	const results = await Promise.allSettled(
		event.Records.map(record => processRecord(record))
	);

	// Check for failures
	const failures = results.filter(r => r.status === 'rejected');
	if (failures.length > 0) {
		logger.error('Batch processing failed', new Error(`Failed to process ${failures.length} messages`), {
			totalMessages: event.Records.length,
			failedMessages: failures.length,
			successfulMessages: results.length - failures.length
		});
		// SQS will automatically retry failed messages
		throw new Error(`Failed to process ${failures.length} messages`);
	}

	logger.info('Batch processing complete', {
		totalMessages: event.Records.length,
		successfulMessages: results.length
	});
}
