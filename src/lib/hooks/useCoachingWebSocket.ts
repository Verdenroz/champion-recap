/**
 * WebSocket hook for real-time coaching observations.
 *
 * Connects to AWS API Gateway WebSocket API and receives streaming
 * coaching observations as matches are analyzed.
 */
import { writable, type Writable } from 'svelte/store';

export interface CoachingObservation {
	matchNumber: number;
	text: string;
	audioUrl?: string;
	champion: string;
	timestamp: string;
}

export interface CoachingToken {
	matchNumber: number;
	token: string;
}

export type CoachingConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface CoachingWebSocketStore {
	connectionState: Writable<CoachingConnectionState>;
	observations: Writable<CoachingObservation[]>;
	currentObservation: Writable<string>;
	currentMatchNumber: Writable<number | null>;
	error: Writable<string | null>;
	disconnect: () => void;
}

/**
 * Create a WebSocket connection for coaching observations.
 *
 * @param wsUrl - WebSocket URL from API Gateway
 * @param sessionId - Coaching session ID
 * @param puuid - Player PUUID for session creation
 * @param champion - Champion personality for coaching
 * @returns Store with connection state and observations
 */
export function useCoachingWebSocket(
	wsUrl: string,
	sessionId: string,
	puuid: string,
	champion: string
): CoachingWebSocketStore {
	const connectionState = writable<CoachingConnectionState>('connecting');
	const observations = writable<CoachingObservation[]>([]);
	const currentObservation = writable<string>('');
	const currentMatchNumber = writable<number | null>(null);
	const error = writable<string | null>(null);

	let ws: WebSocket | null = null;
	let reconnectAttempts = 0;
	const maxReconnectAttempts = 5;
	let sessionObservationsCount = 0; // Track observations received before disconnect

	function connect() {
		try {
			connectionState.set('connecting');

			// Add session_id, puuid, and champion as query parameters
			const url = `${wsUrl}?sessionId=${sessionId}&puuid=${puuid}&champion=${champion}`;
			ws = new WebSocket(url);

			ws.onopen = () => {
				console.log('[Coaching WebSocket] Connected');
				connectionState.set('connected');
				reconnectAttempts = 0;
				error.set(null);

				// State sync: Send last observation count to server for resuming
				// This allows server to re-send any missed observations
				if (sessionObservationsCount > 0) {
					console.log(
						`[Coaching WebSocket] Syncing state: ${sessionObservationsCount} observations received`
					);
					ws?.send(
						JSON.stringify({
							action: 'sync',
							lastObservationCount: sessionObservationsCount
						})
					);
				}
			};

			ws.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data);
					handleMessage(message);
				} catch (err) {
					console.error('[Coaching WebSocket] Failed to parse message:', err);
					error.set('Failed to parse coaching message');
				}
			};

			ws.onerror = (event) => {
				console.error('[Coaching WebSocket] Error:', event);
				connectionState.set('error');
				error.set('WebSocket connection error');
			};

			ws.onclose = (event) => {
				console.log('[Coaching WebSocket] Closed:', event.code, event.reason);
				connectionState.set('disconnected');

				// Attempt reconnect if not intentional close
				if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
					reconnectAttempts++;
					// Exponential backoff: 1s, 2s, 4s, 8s, 16s with jitter
					const baseDelay = Math.pow(2, reconnectAttempts - 1) * 1000;
					const jitter = Math.random() * 1000; // 0-1s jitter
					const delay = baseDelay + jitter;

					console.log(
						`[Coaching WebSocket] Reconnecting... Attempt ${reconnectAttempts}/${maxReconnectAttempts} in ${Math.round(delay)}ms`
					);
					setTimeout(connect, delay);
				} else if (reconnectAttempts >= maxReconnectAttempts) {
					error.set('Failed to reconnect. Please refresh the page to resume.');
				}
			};
		} catch (err) {
			console.error('[Coaching WebSocket] Connection failed:', err);
			connectionState.set('error');
			error.set(err instanceof Error ? err.message : 'Connection failed');
		}
	}

	function handleMessage(message: any) {
		console.log('[Coaching WebSocket] Message:', message);

		switch (message.type) {
			case 'welcome':
				// Welcome message with initial audio
				const welcomeObs: CoachingObservation = {
					matchNumber: 0,
					text: message.text,
					audioUrl: message.audio_url,
					champion: message.champion,
					timestamp: new Date().toISOString()
				};
				observations.update((obs) => [...obs, welcomeObs]);
				sessionObservationsCount++; // Track for state sync
				break;

			case 'quick_remark':
				// Quick remark observation (20-30 words)
				const remarkObs: CoachingObservation = {
					matchNumber: message.match_number,
					text: message.text,
					audioUrl: message.audio_url,
					champion: message.champion,
					timestamp: new Date().toISOString()
				};
				observations.update((obs) => [...obs, remarkObs]);
				sessionObservationsCount++; // Track for state sync
				break;

			case 'conclusion':
				// Final conclusion observation (80-100 words)
				const conclusionObs: CoachingObservation = {
					matchNumber: -1, // Special marker for conclusion
					text: message.text,
					audioUrl: message.audio_url,
					champion: message.champion,
					timestamp: new Date().toISOString()
				};
				observations.update((obs) => [...obs, conclusionObs]);
				sessionObservationsCount++; // Track for state sync
				break;

			case 'error':
				console.error('[Coaching WebSocket] Server error:', message.message);
				error.set(message.message || 'Coaching error occurred');
				break;

			default:
				console.warn('[Coaching WebSocket] Unknown message type:', message.type);
		}
	}

	function disconnect() {
		if (ws) {
			ws.close(1000, 'Client disconnect');
			ws = null;
		}
		connectionState.set('disconnected');
	}

	// Auto-connect on creation
	connect();

	// Return store interface with disconnect method
	return {
		connectionState,
		observations,
		currentObservation,
		currentMatchNumber,
		error,
		disconnect
	};
}
