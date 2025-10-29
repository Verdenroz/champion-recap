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
				// Step 1: Trigger processing on AWS and get complete account data
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
				const account = triggerData.account;

				if (!puuid) {
					throw new Error('Failed to get player PUUID from AWS');
				}

				// Send complete account data immediately (summoner, ranked, mastery)
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({
							type: 'player_info',
							account: account
						})}\n\n`
					)
				);

				// Step 2: Poll for progressive results until complete
				// Poll at a consistent rate (every 5 seconds) until processing is complete
				const pollInterval = 5000; // 5 seconds between polls

				// Poll indefinitely until complete
				while (true) {
					await new Promise((resolve) => setTimeout(resolve, pollInterval));

					// First, check player status for progress info
					const playerUrl = `${PUBLIC_AWS_API_URL}/player/status?puuid=${puuid}&year=${year}`;
					let playerData: any = null;
					let isComplete = false;

					try {
						const playerResponse = await fetch(playerUrl);
						if (playerResponse.ok) {
							playerData = await playerResponse.json();
							isComplete = playerData.status === 'COMPLETE';

							// Send status update with match counts
							controller.enqueue(
								encoder.encode(
									`data: ${JSON.stringify({
										type: 'status',
										message: `Processing ${playerData.processedMatches || 0}/${playerData.totalMatches || 0} matches...`,
										totalMatches: playerData.totalMatches || 0,
										processedMatches: playerData.processedMatches || 0,
										status: playerData.status
									})}\n\n`
								)
							);
						}
					} catch (e) {
						// If we can't get player status yet, continue
					}

					// Try to fetch the recap (partial or complete)
					const recapUrl = `${PUBLIC_AWS_API_URL}/player/recap?puuid=${puuid}&year=${year}`;
					const recapResponse = await fetch(recapUrl);

					if (recapResponse.ok) {
						const recapData = await recapResponse.json();

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
					} else if (!playerData) {
						// Only send generic progress if we don't have player data
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({
									type: 'progress',
									message: `Processing matches...`
								})}\n\n`
							)
						);
					}
				}
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
