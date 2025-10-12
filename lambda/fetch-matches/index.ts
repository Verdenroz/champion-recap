import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const lambdaClient = new LambdaClient({});

const MATCH_DATA_BUCKET = process.env.MATCH_DATA_BUCKET!;
const PLAYER_TABLE = process.env.PLAYER_TABLE!;
const MATCH_PROCESSING_QUEUE_URL = process.env.MATCH_PROCESSING_QUEUE_URL!;
const RIOT_API_KEY = process.env.RIOT_API_KEY!;

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
 * Check if match exists in S3
 */
async function matchExistsInS3(matchId: string): Promise<boolean> {
	const key = `matches/${matchId}.json`;

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
 * Check which matches are already cached
 */
async function filterUncachedMatches(matchIds: string[]): Promise<{ cached: string[], uncached: string[] }> {
	const cached: string[] = [];
	const uncached: string[] = [];

	// Check in batches of 50 to avoid throttling
	const batchSize = 50;
	for (let i = 0; i < matchIds.length; i += batchSize) {
		const batch = matchIds.slice(i, i + batchSize);

		const results = await Promise.all(
			batch.map(async (matchId) => ({
				matchId,
				exists: await matchExistsInS3(matchId)
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
		console.log(`Queued ${queued}/${matchIds.length} matches`);
	}
}

/**
 * Save/Update player processing status in DynamoDB
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
		}
	});

	await docClient.send(command);
}

/**
 * Trigger initial aggregation with cached matches
 */
async function triggerInitialAggregation(puuid: string, year: number) {
	const aggregateFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME?.replace('fetch-matches', 'aggregate-stats');

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
	console.log('Triggered initial aggregation for', puuid, year);
}

/**
 * Lambda handler
 */
export async function handler(event: FetchMatchesEvent) {
	console.log('Fetching matches for:', event);

	try {
		const {
			gameName,
			tagLine,
			platform = 'na1',
			region = 'americas',
			year = new Date().getFullYear()
		} = event;

		// Step 1: Get player PUUID
		console.log('Fetching account...');
		const account = await getAccountByRiotId(gameName, tagLine, region) as { puuid: string };
		const puuid = account.puuid;
		console.log('PUUID:', puuid);

		// Step 2: Check if we already have recent data
		const existingData = await docClient.send(new GetCommand({
			TableName: PLAYER_TABLE,
			Key: { puuid, year }
		}));

		if (existingData.Item && existingData.Item.status === 'PROCESSING') {
			console.log('Already processing for this player/year');
			return {
				statusCode: 200,
				body: JSON.stringify({
					puuid,
					year,
					status: 'ALREADY_PROCESSING',
					message: 'Processing already in progress'
				})
			};
		}

		// Step 3: Get all match IDs for the year
		console.log('Fetching match IDs...');
		const matchIds = await getAllMatchIdsForYear(puuid, region, year);
		console.log(`Found ${matchIds.length} total matches`);

		// Step 4: Filter out cached matches
		console.log('Checking S3 cache...');
		const { cached, uncached } = await filterUncachedMatches(matchIds);
		console.log(`Cached: ${cached.length}, Need to fetch: ${uncached.length}`);

		// Step 5: Update player status to PROCESSING
		await updatePlayerStatus(
			puuid,
			year,
			'PROCESSING',
			account,
			matchIds.length,
			cached.length,
			uncached.length
		);

		// Step 6: Queue uncached matches for processing
		if (uncached.length > 0) {
			console.log('Queuing matches for processing...');
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
		console.error('Error fetching matches:', error);
		return {
			statusCode: 500,
			body: JSON.stringify({
				error: 'Failed to fetch matches',
				message: error instanceof Error ? error.message : String(error)
			})
		};
	}
}
