/**
 * Coaching API endpoint - Initialize coaching sessions
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const AWS_API_URL = import.meta.env.PUBLIC_AWS_API_URL || process.env.PUBLIC_AWS_API_URL;
const WS_API_URL = import.meta.env.PUBLIC_WS_API_URL || process.env.PUBLIC_WS_API_URL;

/**
 * POST /api/coaching
 * Initialize a coaching session and return WebSocket URL
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { puuid, topChampion } = body;

		if (!puuid) {
			throw error(400, 'Missing required parameter: puuid');
		}

		if (!topChampion) {
			throw error(400, 'Missing required parameter: topChampion');
		}

		// Generate session ID
		const sessionId = crypto.randomUUID();

		// Return WebSocket connection info
		return json({
			sessionId,
			wsUrl: WS_API_URL,
			topChampion,
			message: 'Coaching session initialized'
		});
	} catch (err) {
		console.error('[Coaching API] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		throw error(500, {
			message: err instanceof Error ? err.message : 'Failed to initialize coaching session'
		});
	}
};

/**
 * GET /api/coaching/status?sessionId=xxx
 * Check coaching session status
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const sessionId = url.searchParams.get('sessionId');

		if (!sessionId) {
			throw error(400, 'Missing required parameter: sessionId');
		}

		// In production, this would query DynamoDB for session status
		// For now, return a simple response
		return json({
			sessionId,
			status: 'active',
			message: 'Session is active'
		});
	} catch (err) {
		console.error('[Coaching API] Error:', err);

		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		throw error(500, {
			message: err instanceof Error ? err.message : 'Failed to get session status'
		});
	}
};
