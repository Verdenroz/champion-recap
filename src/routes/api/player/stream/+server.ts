import { PUBLIC_AWS_API_URL } from '$env/static/public';
import type { RequestHandler } from './$types';

/**
 * Server-Sent Events (SSE) endpoint for progressive player data loading
 * This polls the AWS backend and streams updates to the frontend
 */
export const GET: RequestHandler = async ({ url }) => {
	const gameName = url.searchParams.get('gameName');
	const tagLine = url.searchParams.get('tagLine');
	const platform = url.searchParams.get('platform') || 'na1';
	const region = url.searchParams.get('region') || 'americas';
	const yearParam = url.searchParams.get('year');
	const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();

	if (!gameName || !tagLine) {
		return new Response(JSON.stringify({ error: 'gameName and tagLine are required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Create a ReadableStream for Server-Sent Events
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			try {
				// Step 1: Trigger processing on AWS
				const triggerUrl = `${PUBLIC_AWS_API_URL}/player?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}&platform=${platform}&region=${region}&year=${year}`;

				const triggerResponse = await fetch(triggerUrl);

				// Handle specific error cases
				if (!triggerResponse.ok) {
					const errorData = await triggerResponse.json();

					if (triggerResponse.status === 429) {
						throw new Error('Rate limited by Riot API. Please try again in a few seconds.');
					}
					if (triggerResponse.status === 404) {
						throw new Error('Player not found. Please check the game name and tag line.');
					}

					throw new Error(errorData.message || 'Failed to trigger processing');
				}

				const triggerData = await triggerResponse.json();
				const puuid = triggerData.puuid;

				if (!puuid) {
					throw new Error('Failed to get player PUUID from AWS');
				}

				// Send initial status
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({
							type: 'status',
							message: 'Processing started on AWS',
							status: triggerData.status,
							puuid: puuid
						})}\n\n`
					)
				);

				// Step 2: Poll for progressive results
				let attempts = 0;
				const maxAttempts = 60; // 60 attempts over ~3-4 minutes (for large match histories)

				// Poll for results
				while (attempts < maxAttempts) {
					attempts++;
					// Start with 2 seconds, then add 200ms per attempt (max ~10s between polls)
					const delay = Math.min(2000 + attempts * 200, 10000);
					await new Promise((resolve) => setTimeout(resolve, delay));

					// Try to fetch the recap (partial or complete)
					const recapUrl = `${PUBLIC_AWS_API_URL}/player/recap?puuid=${puuid}&year=${year}`;
					const recapResponse = await fetch(recapUrl);

					if (recapResponse.ok) {
						const recapData = await recapResponse.json();

						// Check if processing is complete by looking at the player status
						const playerUrl = `${PUBLIC_AWS_API_URL}/player/status?puuid=${puuid}&year=${year}`;
						let isComplete = false;
						try {
							const playerResponse = await fetch(playerUrl);
							if (playerResponse.ok) {
								const playerData = await playerResponse.json();
								isComplete = playerData.status === 'COMPLETE';
							}
						} catch (e) {
							// If we can't get player status, assume not complete yet
						}

						// Send the champion stats (partial or complete)
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({
									type: isComplete ? 'complete' : 'partial',
									data: recapData
								})}\n\n`
							)
						);

						// If complete, close the stream
						if (isComplete) {
							controller.close();
							return;
						}
					} else {
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({
									type: 'progress',
									message: `Processing matches... (${attempts}/${maxAttempts})`,
									attempt: attempts
								})}\n\n`
							)
						);
					}
				}

				// Timeout
				throw new Error('Processing timeout - please try again');
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
