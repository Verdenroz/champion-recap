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
 * @returns Store with connection state and observations
 */
export function useCoachingWebSocket(
	wsUrl: string,
	sessionId: string
): CoachingWebSocketStore {
	const connectionState = writable<CoachingConnectionState>('connecting');
	const observations = writable<CoachingObservation[]>([]);
	const currentObservation = writable<string>('');
	const currentMatchNumber = writable<number | null>(null);
	const error = writable<string | null>(null);

	let ws: WebSocket | null = null;
	let reconnectAttempts = 0;
	const maxReconnectAttempts = 3;

	function connect() {
		try {
			connectionState.set('connecting');

			// Add session_id as query parameter
			const url = `${wsUrl}?sessionId=${sessionId}`;
			ws = new WebSocket(url);

			ws.onopen = () => {
				console.log('[Coaching WebSocket] Connected');
				connectionState.set('connected');
				reconnectAttempts = 0;
				error.set(null);
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
					console.log(`[Coaching WebSocket] Reconnecting... Attempt ${reconnectAttempts}`);
					setTimeout(connect, 1000 * reconnectAttempts);
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
			case 'observation_token':
				// Streaming token for current observation
				currentMatchNumber.set(message.match_number);
				currentObservation.update((text) => text + message.token);
				break;

			case 'observation_complete':
				// Complete observation with audio
				const observation: CoachingObservation = {
					matchNumber: message.match_number,
					text: message.text,
					audioUrl: message.audio_url,
					champion: message.champion,
					timestamp: new Date().toISOString()
				};

				observations.update((obs) => [...obs, observation]);

				// Reset current observation for next match
				currentObservation.set('');
				currentMatchNumber.set(null);
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
