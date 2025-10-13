import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({});

const PLAYER_TABLE = process.env.PLAYER_TABLE!;
const CHAMPION_STATS_TABLE = process.env.CHAMPION_STATS_TABLE!;
const FETCH_MATCHES_FUNCTION_ARN = process.env.FETCH_MATCHES_FUNCTION_ARN!;

interface APIGatewayEvent {
	httpMethod: string;
	path: string;
	queryStringParameters: Record<string, string> | null;
	headers: Record<string, string>;
}

/**
 * Get player recap from DynamoDB
 */
async function getPlayerRecap(puuid: string, year: number) {
	const command = new GetCommand({
		TableName: CHAMPION_STATS_TABLE,
		Key: { puuid, year }
	});

	const response = await docClient.send(command);
	return response.Item;
}

/**
 * Get PUUID from Riot API
 */
async function getPuuidFromRiot(gameName: string, tagLine: string, region: string): Promise<string> {
	const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;

	const response = await fetch(url, {
		headers: { 'X-Riot-Token': process.env.RIOT_API_KEY || '' }
	});

	if (!response.ok) {
		if (response.status === 429) {
			throw new Error('RATE_LIMITED');
		}
		if (response.status === 404) {
			throw new Error('PLAYER_NOT_FOUND');
		}
		throw new Error(`Failed to fetch account: ${response.status}`);
	}

	const data = await response.json() as { puuid: string };
	return data.puuid;
}

/**
 * Trigger match fetching for a player (async)
 */
async function triggerMatchFetch(gameName: string, tagLine: string, platform: string, region: string, year: number) {
	const payload = {
		gameName,
		tagLine,
		platform,
		region,
		year
	};

	const command = new InvokeCommand({
		FunctionName: FETCH_MATCHES_FUNCTION_ARN,
		InvocationType: 'Event', // Async invocation
		Payload: Buffer.from(JSON.stringify(payload))
	});

	await lambdaClient.send(command);
}

/**
 * Lambda handler
 */
export async function handler(event: APIGatewayEvent) {
	console.log('API Request:', event);

	const corsHeaders = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type'
	};

	try {
		// Handle CORS preflight
		if (event.httpMethod === 'OPTIONS') {
			return {
				statusCode: 200,
				headers: corsHeaders,
				body: ''
			};
		}

		const params = event.queryStringParameters || {};

		// Route: GET /player - Fetch player data
		if (event.path === '/player' && event.httpMethod === 'GET') {
			const { gameName, tagLine, platform = 'na1', region = 'americas', year } = params;

			if (!gameName || !tagLine) {
				return {
					statusCode: 400,
					headers: corsHeaders,
					body: JSON.stringify({ error: 'gameName and tagLine are required' })
				};
			}

			const currentYear = year ? parseInt(year) : new Date().getFullYear();

			try {
				// Get PUUID from Riot API (fast)
				const puuid = await getPuuidFromRiot(gameName, tagLine, region);

				// Trigger match fetching asynchronously (don't wait)
				await triggerMatchFetch(gameName, tagLine, platform, region, currentYear);

				return {
					statusCode: 202,
					headers: corsHeaders,
					body: JSON.stringify({
						message: 'Processing started',
						status: 'PENDING',
						puuid: puuid
					})
				};
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);

				if (errorMessage === 'RATE_LIMITED') {
					return {
						statusCode: 429,
						headers: corsHeaders,
						body: JSON.stringify({
							error: 'Rate limited by Riot API',
							message: 'Too many requests. Please try again in a few seconds.'
						})
					};
				}

				if (errorMessage === 'PLAYER_NOT_FOUND') {
					return {
						statusCode: 404,
						headers: corsHeaders,
						body: JSON.stringify({
							error: 'Player not found',
							message: 'Could not find a player with that game name and tag line.'
						})
					};
				}

				throw error; // Re-throw other errors to be caught by outer handler
			}
		}

		// Route: GET /player/recap - Get player recap
		if (event.path === '/player/recap' && event.httpMethod === 'GET') {
			const { puuid, year } = params;

			if (!puuid) {
				return {
					statusCode: 400,
					headers: corsHeaders,
					body: JSON.stringify({ error: 'puuid is required' })
				};
			}

			const currentYear = year ? parseInt(year) : new Date().getFullYear();

			const recap = await getPlayerRecap(puuid, currentYear);

			if (!recap) {
				return {
					statusCode: 404,
					headers: corsHeaders,
					body: JSON.stringify({ error: 'Recap not found. Processing may still be in progress.' })
				};
			}

			return {
				statusCode: 200,
				headers: corsHeaders,
				body: JSON.stringify(recap)
			};
		}

		// Route: GET /player/status - Get player processing status
		if (event.path === '/player/status' && event.httpMethod === 'GET') {
			const { puuid, year } = params;

			if (!puuid) {
				return {
					statusCode: 400,
					headers: corsHeaders,
					body: JSON.stringify({ error: 'puuid is required' })
				};
			}

			const currentYear = year ? parseInt(year) : new Date().getFullYear();

			const command = new GetCommand({
				TableName: PLAYER_TABLE,
				Key: { puuid, year: currentYear }
			});

			const response = await docClient.send(command);

			if (!response.Item) {
				return {
					statusCode: 404,
					headers: corsHeaders,
					body: JSON.stringify({ error: 'Player not found' })
				};
			}

			return {
				statusCode: 200,
				headers: corsHeaders,
				body: JSON.stringify({
					puuid: response.Item.puuid,
					status: response.Item.status,
					totalMatches: response.Item.totalMatches,
					processedMatches: response.Item.processedMatches,
					lastUpdated: response.Item.lastUpdated
				})
			};
		}

		// Unknown route
		return {
			statusCode: 404,
			headers: corsHeaders,
			body: JSON.stringify({ error: 'Route not found' })
		};
	} catch (error) {
		console.error('API Error:', error);
		return {
			statusCode: 500,
			headers: corsHeaders,
			body: JSON.stringify({ error: 'Internal server error' })
		};
	}
}
