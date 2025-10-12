import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});

const MATCH_DATA_BUCKET = process.env.MATCH_DATA_BUCKET!;
const PLAYER_TABLE = process.env.PLAYER_TABLE!;
const RIOT_API_KEY = process.env.RIOT_API_KEY!;

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
				console.log(`Rate limited, waiting ${retryAfter}s before retry ${attempt}/${maxRetries}`);
				await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
				continue;
			}

			if (response.status === 404) {
				// Match not found, skip it
				console.log(`Match ${matchId} not found (404)`);
				return null;
			}

			throw new Error(`Failed to fetch match: ${response.status}`);
		} catch (error) {
			if (attempt === maxRetries) {
				throw error;
			}
			console.log(`Attempt ${attempt}/${maxRetries} failed, retrying...`);
			await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
		}
	}
}

/**
 * Save match data to S3
 */
async function saveMatchToS3(matchId: string, matchData: any) {
	const key = `matches/${matchId}.json`;
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

	console.log(`Progress: ${processed}/${total} matches`);

	return true;
}

/**
 * Trigger aggregation Lambda
 */
async function triggerAggregation(puuid: string, year: number) {
	const aggregateFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME?.replace('process-match', 'aggregate-stats');

	if (!aggregateFunctionName) {
		console.error('Could not determine aggregate function name');
		return;
	}

	const command = new InvokeCommand({
		FunctionName: aggregateFunctionName,
		InvocationType: 'Event', // Async
		Payload: Buffer.from(JSON.stringify({ puuid, year }))
	});

	await lambdaClient.send(command);
	console.log('Triggered aggregation for', puuid, year);
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
	console.log('Marked player as COMPLETE:', puuid, year);
}

/**
 * Process a single SQS record
 */
async function processRecord(record: SQSRecord) {
	const message: MatchMessage = JSON.parse(record.body);
	const { matchId, puuid, region, year } = message;

	console.log(`Processing match: ${matchId} for player ${puuid}`);

	try {
		// Fetch match data from Riot API
		const matchData = await getMatchById(matchId, region);

		if (!matchData) {
			// Match not found, just increment counter
			console.log(`Skipping match ${matchId} (not found)`);
			await incrementProcessedMatches(puuid, year);
			return;
		}

		// Save to S3
		await saveMatchToS3(matchId, matchData);

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

		console.log(`Successfully processed match ${matchId}`);
	} catch (error) {
		console.error(`Failed to process match ${matchId}:`, error);
		throw error; // Let SQS retry
	}
}

/**
 * Lambda handler for SQS events
 */
export async function handler(event: SQSEvent) {
	console.log(`Processing ${event.Records.length} messages`);

	const results = await Promise.allSettled(
		event.Records.map(record => processRecord(record))
	);

	// Check for failures
	const failures = results.filter(r => r.status === 'rejected');
	if (failures.length > 0) {
		console.error(`${failures.length} messages failed processing`);
		// SQS will automatically retry failed messages
		throw new Error(`Failed to process ${failures.length} messages`);
	}

	console.log('All messages processed successfully');
}
