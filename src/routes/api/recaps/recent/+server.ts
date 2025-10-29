import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

/**
 * API endpoint to fetch recent player recaps from DynamoDB
 * Queries the ChampionRecap-Players table for recent processing/completed recaps
 */

// Initialize DynamoDB client
const client = new DynamoDBClient({
	region: process.env.AWS_REGION || 'us-east-1'
});

const docClient = DynamoDBDocumentClient.from(client);

const PLAYERS_TABLE = 'ChampionRecap-Players';
const STATS_TABLE = 'ChampionRecap-Stats';

interface RecentRecap {
	gameName: string;
	tagLine: string;
	status: 'processing' | 'completed';
	progress?: number;
	topChampion?: string;
	matches?: number;
	puuid: string;
	updatedAt: number;
}

export const GET: RequestHandler = async () => {
	try {
		// Scan the Players table for recent recaps
		// We'll get the 20 most recently updated players
		const scanCommand = new ScanCommand({
			TableName: PLAYERS_TABLE,
			Limit: 20,
			ProjectionExpression: 'puuid, accountData, #year, #status, totalMatches, processedMatches, updatedAt',
			ExpressionAttributeNames: {
				'#status': 'status',
				'#year': 'year'
			}
		});

		const response = await docClient.send(scanCommand);

		if (!response.Items || response.Items.length === 0) {
			return json([]);
		}

		// Sort by updatedAt timestamp (most recent first)
		const sortedItems = response.Items.sort((a, b) => {
			const aTime = a.updatedAt || 0;
			const bTime = b.updatedAt || 0;
			return bTime - aTime;
		});

		// Take only the 6 most recent
		const recentItems = sortedItems.slice(0, 6);

		// Transform the data for the frontend
		const recaps: RecentRecap[] = [];

		for (const item of recentItems) {
			// Extract gameName and tagLine from accountData
			const gameName = item.accountData?.gameName || 'Unknown';
			const tagLine = item.accountData?.tagLine || '???';

			const recap: RecentRecap = {
				gameName,
				tagLine,
				status: item.status === 'COMPLETE' ? 'completed' : 'processing',
				puuid: item.puuid,
				updatedAt: item.updatedAt || 0
			};

			// Calculate progress percentage for processing recaps
			if (recap.status === 'processing' && item.totalMatches && item.processedMatches) {
				recap.progress = Math.round((item.processedMatches / item.totalMatches) * 100);
			}

			// For completed recaps, try to fetch the top champion
			if (recap.status === 'completed') {
				// Use totalMatches from the Players table
				if (item.totalMatches) {
					recap.matches = item.totalMatches;
				}

				try {
					// Query the Stats table to get top champion
					const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
					const statsCommand = new GetCommand({
						TableName: STATS_TABLE,
						Key: {
							puuid: item.puuid,
							year: item.year || new Date().getFullYear()
						}
					});

					const statsResponse = await docClient.send(statsCommand);

					if (statsResponse.Item?.stats) {
						const stats = statsResponse.Item.stats;
						// Get the top champion
						if (stats.top3Champions && stats.top3Champions.length > 0) {
							recap.topChampion = stats.top3Champions[0].championName;
						}
					}
				} catch (err) {
					// If we can't get stats, just skip this data
					console.error('Failed to fetch stats for recap:', err);
				}
			}

			recaps.push(recap);
		}

		return json(recaps);
	} catch (err) {
		console.error('Error fetching recent recaps:', err);

		// Return empty array instead of error to allow graceful degradation
		return json([]);
	}
};
