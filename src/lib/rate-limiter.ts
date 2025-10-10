import PQueue from 'p-queue';
import pRetry, { type Options as RetryOptions, AbortError } from 'p-retry';

/**
 * Rate limiter for Riot API requests
 *
 * Riot API Rate Limits (Development Key):
 * - 20 requests per 1 second
 * - 100 requests per 2 minutes
 *
 * Production Key (if you upgrade):
 * - 3000 requests per 10 seconds
 * - 180000 requests per 10 minutes
 */

interface RateLimitConfig {
	requestsPerSecond: number;
	requestsPer2Minutes: number;
}

class RiotRateLimiter {
	private queue: PQueue;
	private requestTimestamps: number[] = [];
	private config: RateLimitConfig;

	constructor(config: RateLimitConfig = { requestsPerSecond: 20, requestsPer2Minutes: 100 }) {
		this.config = config;

		// Use p-queue to manage concurrent requests
		// We'll be conservative and limit to 15 requests per second to have buffer
		this.queue = new PQueue({
			concurrency: 1, // Process one at a time to have precise control
			interval: 1000, // 1 second
			intervalCap: Math.floor(config.requestsPerSecond * 0.75) // 75% of limit for safety
		});
	}

	/**
	 * Execute a function with rate limiting and retry logic
	 */
	async execute<T>(fn: () => Promise<T>, retryOptions?: RetryOptions): Promise<T> {
		return this.queue.add(async () => {
			// Clean up old timestamps (older than 2 minutes)
			const twoMinutesAgo = Date.now() - 120000;
			this.requestTimestamps = this.requestTimestamps.filter((ts) => ts > twoMinutesAgo);

			// Check if we're approaching the 2-minute limit
			if (this.requestTimestamps.length >= this.config.requestsPer2Minutes * 0.9) {
				// Wait until the oldest request is older than 2 minutes
				const oldestTimestamp = this.requestTimestamps[0];
				const waitTime = 120000 - (Date.now() - oldestTimestamp);
				if (waitTime > 0) {
					console.log(`Rate limit approached, waiting ${waitTime}ms`);
					await new Promise((resolve) => setTimeout(resolve, waitTime));
				}
			}

			// Execute with retry logic
			const result = await pRetry(
				async () => {
					try {
						const response = await fn();
						// Record successful request
						this.requestTimestamps.push(Date.now());
						return response;
					} catch (error: any) {
						// Check if it's a rate limit error
						if (error.message?.includes('429') || error.status === 429) {
							console.log('Rate limit hit (429), retrying...');
							// Throw to trigger retry
							throw new AbortError('Rate limit exceeded');
						}
						// For other errors, throw to trigger retry
						throw error;
					}
				},
				{
					retries: 3,
					factor: 2,
					minTimeout: 1000,
					maxTimeout: 5000,
					onFailedAttempt: (error) => {
						console.log(
							`Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`
						);
					},
					...retryOptions
				}
			);

			return result;
		}) as Promise<T>;
	}

	/**
	 * Get current queue statistics
	 */
	getStats() {
		return {
			pending: this.queue.pending,
			size: this.queue.size,
			recentRequests: this.requestTimestamps.length
		};
	}

	/**
	 * Clear the queue (useful for testing)
	 */
	clear() {
		this.queue.clear();
		this.requestTimestamps = [];
	}
}

// Export a singleton instance
export const riotRateLimiter = new RiotRateLimiter();

/**
 * Helper function to wrap Riot API calls with rate limiting
 */
export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
	return riotRateLimiter.execute(fn);
}
