/**
 * Environment variable validation utility
 * Validates required environment variables at Lambda initialization
 *
 * AWS Best Practice: https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html
 */

/**
 * Validate required environment variables
 * Throws error if any required variables are missing
 *
 * @param required - Array of required environment variable names
 * @throws Error if any required variables are missing
 */
export function validateEnvironment(required: string[]): void {
	const missing = required.filter(key => !process.env[key]);

	if (missing.length > 0) {
		throw new Error(
			`Missing required environment variables: ${missing.join(', ')}. ` +
			`Lambda function cannot start without these variables.`
		);
	}
}

/**
 * Get environment variable with validation
 * Throws error if variable is missing
 *
 * @param key - Environment variable name
 * @param defaultValue - Optional default value
 * @returns Environment variable value
 */
export function getEnv(key: string, defaultValue?: string): string {
	const value = process.env[key];

	if (!value && !defaultValue) {
		throw new Error(`Missing required environment variable: ${key}`);
	}

	return value || defaultValue!;
}
