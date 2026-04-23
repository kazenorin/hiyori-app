import { AISDKError, APICallError } from 'ai';

export function getErrorMessage(err: unknown): string {
	if (APICallError.isInstance(err)) return `[APICallError] ${err.message}: ${err.responseBody}}`;
	if (AISDKError.isInstance(err)) return `[${err.name}] ${err.message}}`;
	if (err instanceof Error) return `[${err.name}] ${err.message}, cause: ${err.cause}`;
	return 'An unexpected error occurred.';
}
