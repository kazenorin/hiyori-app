// Shared async utility functions

/**
 * Sleep for the specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
