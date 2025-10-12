import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { aggregateChampionStats } from './champion-stats';
import type { MatchDto } from './riot';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const CHAMPION_STATS_TABLE = process.env.CHAMPION_STATS_TABLE!;
const PLAYER_TABLE = process.env.PLAYER_TABLE!;
const MATCH_DATA_BUCKET = process.env.MATCH_DATA_BUCKET!;

interface AggregateStatsEvent {
	puuid: string;
	year: number;
	matchIds?: string[]; // Optional: specific matches to process
}

/**
 * Fetch match data from S3
 */
async function fetchMatchFromS3(matchId: string): Promise<MatchDto> {
	const key = `matches/${matchId}.json`;
	const command = new GetObjectCommand({
		Bucket: MATCH_DATA_BUCKET,
		Key: key
	});

	const response = await s3Client.send(command);
	const body = await response.Body!.transformToString();
	return JSON.parse(body);
}

/**
 * Get all match IDs from S3 (list all matches in the bucket)
 */
async function getAllMatchIdsFromS3(): Promise<string[]> {
	const matchIds: string[] = [];
	let continuationToken: string | undefined;

	do {
		const command = new ListObjectsV2Command({
			Bucket: MATCH_DATA_BUCKET,
			Prefix: 'matches/',
			ContinuationToken: continuationToken
		});

		const response = await s3Client.send(command);

		if (response.Contents) {
			for (const object of response.Contents) {
				if (object.Key) {
					// Extract match ID from key: matches/NA1_1234567890.json -> NA1_1234567890
					const matchId = object.Key.replace('matches/', '').replace('.json', '');
					matchIds.push(matchId);
				}
			}
		}

		continuationToken = response.NextContinuationToken;
	} while (continuationToken);

	return matchIds;
}

/**
 * Save champion statistics to DynamoDB
 */
async function saveChampionStats(puuid: string, year: number, stats: any) {
	const command = new PutCommand({
		TableName: CHAMPION_STATS_TABLE,
		Item: {
			puuid,
			year,
			stats,
			lastUpdated: new Date().toISOString(),
			ttl: Math.floor(Date.now() / 1000) + 86400 * 7 // 7 days TTL
		}
	});

	await docClient.send(command);
}

/**
 * Lambda handler
 */
export async function handler(event: AggregateStatsEvent) {
	console.log('Aggregating stats for:', event);

	try {
		const { puuid, year } = event;

		// Get all match IDs from S3
		const matchIds = await getAllMatchIdsFromS3();

		if (matchIds.length === 0) {
			console.log('No matches found in S3');
			return {
				statusCode: 404,
				body: JSON.stringify({ error: 'No matches found' })
			};
		}

		console.log(`Found ${matchIds.length} total matches in S3`);

		// Fetch matches from S3 in parallel (batches of 50)
		const matches: MatchDto[] = [];
		const batchSize = 50;

		for (let i = 0; i < matchIds.length; i += batchSize) {
			const batch = matchIds.slice(i, i + batchSize);
			const batchMatches = await Promise.all(
				batch.map(matchId =>
					fetchMatchFromS3(matchId).catch(err => {
						console.error(`Failed to fetch match ${matchId}:`, err);
						return null;
					})
				)
			);

			matches.push(...batchMatches.filter(m => m !== null) as MatchDto[]);
			console.log(`Fetched ${matches.length}/${matchIds.length} matches`);
		}

		// Aggregate champion statistics
		console.log('Aggregating champion statistics...');
		const championRecap = aggregateChampionStats(matches, puuid);

		// Save to DynamoDB
		await saveChampionStats(puuid, year, championRecap);

		console.log('Champion stats saved successfully');

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
		console.error('Error aggregating stats:', error);
		return {
			statusCode: 500,
			body: JSON.stringify({ error: 'Failed to aggregate stats' })
		};
	}
}
