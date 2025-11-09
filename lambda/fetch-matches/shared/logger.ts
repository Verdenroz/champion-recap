/**
 * Structured logging utility for Lambda functions
 * Provides JSON-formatted logs for better CloudWatch Insights queries
 *
 * AWS Best Practice: https://docs.aws.amazon.com/lambda/latest/dg/typescript-logging.html
 */

export interface LogContext {
	[key: string]: any;
}

export const logger = {
	/**
	 * Log informational message with structured context
	 */
	info: (message: string, context: LogContext = {}) => {
		console.log(JSON.stringify({
			level: 'INFO',
			message,
			timestamp: new Date().toISOString(),
			...context
		}));
	},

	/**
	 * Log warning message with structured context
	 */
	warn: (message: string, context: LogContext = {}) => {
		console.warn(JSON.stringify({
			level: 'WARN',
			message,
			timestamp: new Date().toISOString(),
			...context
		}));
	},

	/**
	 * Log error with full error details and context
	 */
	error: (message: string, error: Error, context: LogContext = {}) => {
		console.error(JSON.stringify({
			level: 'ERROR',
			message,
			error: {
				name: error.name,
				message: error.message,
				stack: error.stack
			},
			timestamp: new Date().toISOString(),
			...context
		}));
	},

	/**
	 * Log debug information (only in development)
	 */
	debug: (message: string, context: LogContext = {}) => {
		if (process.env.LOG_LEVEL === 'DEBUG') {
			console.debug(JSON.stringify({
				level: 'DEBUG',
				message,
				timestamp: new Date().toISOString(),
				...context
			}));
		}
	}
};
