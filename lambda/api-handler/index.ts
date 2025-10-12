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
 * Trigger match fetching for a player
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

			// Trigger async match fetching
			await triggerMatchFetch(gameName, tagLine, platform, region, currentYear);

			return {
				statusCode: 202,
				headers: corsHeaders,
				body: JSON.stringify({
					message: 'Processing started',
					status: 'PENDING'
				})
			};
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
