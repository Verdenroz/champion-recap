import { getPlayerDataProgressive } from '$lib/riot-api';
import type { RequestHandler } from './$types';

/**
 * Server-Sent Events (SSE) endpoint for progressive player data loading
 * This allows the frontend to receive data in chunks as it's fetched
 */
export const GET: RequestHandler = async ({ url }) => {
	const gameName = url.searchParams.get('gameName');
	const tagLine = url.searchParams.get('tagLine');
	const platform = url.searchParams.get('platform') || 'na1';
	const region = url.searchParams.get('region') || 'americas';
	const yearParam = url.searchParams.get('year');
	const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();

	if (!gameName || !tagLine) {
		return new Response(
			JSON.stringify({ error: 'gameName and tagLine are required' }),
			{
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}

	// Create a ReadableStream for Server-Sent Events
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			try {
				// Get the progressive data generator
				const dataGenerator = getPlayerDataProgressive(
					gameName,
					tagLine,
					platform,
					region,
					year
				);

				// Stream each chunk as it becomes available
				for await (const chunk of dataGenerator) {
					const sseMessage = `data: ${JSON.stringify(chunk)}\n\n`;
					controller.enqueue(encoder.encode(sseMessage));
				}

				// Close the stream when done
				controller.close();
			} catch (error) {
				console.error('Error in progressive data fetch:', error);

				const errorMessage =
					error instanceof Error ? error.message : 'Failed to fetch player data';
				const sseError = `data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`;
				controller.enqueue(encoder.encode(sseError));
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
