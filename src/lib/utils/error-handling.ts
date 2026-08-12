import { AISDKError, APICallError } from 'ai';
import { ERR_PROVIDER_UNREACHABLE } from '$lib/definitions/error-messages';

const NETWORK_ERROR_PATTERNS = [
	'failed to fetch',
	'fetch failed',
	'networkerror',
	'network request failed',
	'network is unreachable',
	'connection refused',
	'connection reset',
	'connection closed',
	'could not resolve host',
	"couldn't connect",
	'couldnt connect',
	'dns error',
	'error sending request',
	'econnaborted',
	'econnrefused',
	'econnreset',
	'enotfound',
	'ehostunreach',
	'enetunreach',
	'etimedout',
	'eai_again',
	'curle_couldnt_connect',
	'curle_couldnt_resolve_host',
];

function collectErrorMessages(err: unknown): string[] {
	const messages: string[] = [];
	const seen = new Set<unknown>();
	let current: unknown = err;
	while (current && !seen.has(current)) {
		seen.add(current);
		if (current instanceof Error) {
			messages.push(current.name, current.message);
			current = current.cause;
		} else {
			try {
				messages.push(String(current));
			} catch {
				// ignore non-stringifiable values
			}
			break;
		}
	}
	return messages;
}

/**
 * Check whether an error indicates the AI provider endpoint could not be
 * reached at all (DNS failure, connection refused, timeout, offline, etc.),
 * as opposed to an application-level error returned by the provider.
 */
export function isNetworkError(err: unknown): boolean {
	return collectErrorMessages(err)
		.map((m) => m.toLowerCase())
		.some((m) => NETWORK_ERROR_PATTERNS.some((pattern) => m.includes(pattern)));
}

/**
 * User-facing error message for chat surfaces: maps connectivity failures to
 * actionable guidance, keeps plain error messages otherwise.
 */
export function getUserFacingErrorMessage(err: unknown): string {
	if (isNetworkError(err)) return ERR_PROVIDER_UNREACHABLE;
	if (err instanceof Error) return err.message;
	return 'An unexpected error occurred.';
}

export function getErrorMessage(err: unknown): string {
	if (isNetworkError(err)) return ERR_PROVIDER_UNREACHABLE;
	if (APICallError.isInstance(err)) return `[APICallError] ${err.message}: ${err.responseBody}}`;
	if (AISDKError.isInstance(err)) return `[${err.name}] ${err.message}}`;
	if (err instanceof Error) return `[${err.name}] ${err.message}, cause: ${err.cause}`;
	return 'An unexpected error occurred.';
}
