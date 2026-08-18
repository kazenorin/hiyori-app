import { checkIsTauri } from '$lib/runtime';
import { getSettings } from '$lib/stores/settings.svelte';
import { resolveFetch } from '$lib/http/fetch';

/**
 * Platform-aware fetch. Under Tauri, routes through @tauri-apps/plugin-http
 * (capability already granted) which bypasses webview CORS — user-configured
 * WebDAV/S3 servers cannot be expected to send CORS headers for desktop apps.
 * On web, routes through the WISP proxy (libcurl fetch) when the CORS bypass
 * is enabled in cloud sync settings; otherwise plain fetch — the deployment
 * CSP and server CORS are documented requirements.
 */
export async function syncFetch(input: string | Request, init?: RequestInit): Promise<Response> {
	if (await checkIsTauri()) {
		const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
		return tauriFetch(input, init);
	}
	const sync = getSettings().cloudSync;
	const fetchImpl = await resolveFetch(sync?.corsBypassEnabled, sync?.wispProxyUrl?.trim());
	return fetchImpl(input, init);
}

export interface RetryOptions {
	attempts: number;
	baseDelayMs: number;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < options.attempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (attempt < options.attempts - 1) {
				await new Promise((r) => setTimeout(r, options.baseDelayMs * 2 ** attempt));
			}
		}
	}
	throw lastError;
}
