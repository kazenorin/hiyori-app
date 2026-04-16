// Shared async utility functions

/**
 * Convert an unknown error to a proper Error instance.
 */
export function toError(error: unknown): Error {
	if (error instanceof Error) return error;
	return new Error(String(error));
}

/**
 * Sleep for the specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
	maxAttempts: number;
	backoffMs: number;
	shouldRetry?: (error: Error) => boolean;
	onRetry?: (attempt: number, error: Error) => void | Promise<void>;
}

/**
 * Execute an async function with automatic retry and exponential backoff.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = toError(err);

			if (options.shouldRetry && !options.shouldRetry(lastError)) {
				throw lastError;
			}

			const isLastAttempt = attempt === options.maxAttempts - 1;
			if (isLastAttempt) {
				break;
			}

			if (options.onRetry) {
				await options.onRetry(attempt + 1, lastError);
			}

			const delay = options.backoffMs * (attempt + 1);
			await sleep(delay);
		}
	}

	throw lastError ?? new Error('Retry failed');
}

/**
 * Maximum allowed file size for uploads (50 MB).
 */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Validate that a file is within the maximum allowed size.
 * @throws Error if file exceeds MAX_FILE_SIZE
 */
export function validateFileSize(file: File): void {
	if (file.size > MAX_FILE_SIZE) {
		throw new Error(
			`File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`
		);
	}
}

/**
 * Check if an error is a non-retryable authentication error (401/403).
 */
export function isAuthError(error: Error): boolean {
	const msg = error.message.toLowerCase();
	return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden');
}
