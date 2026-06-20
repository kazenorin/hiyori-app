import { checkIsTauri, isTauriSync } from '$lib/runtime';
import { log } from '$lib/logging/logger';
import { asset } from '$app/paths';

let _fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis);
let initialized = false;

export function fetch(...args: Parameters<typeof globalThis.fetch>): ReturnType<typeof globalThis.fetch> {
	return _fetch(...args);
}

export async function initHttpClient(): Promise<void> {
	if (initialized) return;
	initialized = true;

	if (await checkIsTauri()) {
		const tauriHttp = await import('@tauri-apps/plugin-http');
		_fetch = tauriHttp.fetch;
		await log.info('fetch', 'Using Tauri plugin-http');
	} else {
		await log.info('fetch', 'Using default HTTP Client');
	}
}

let libcurlReady = false;
let libcurlInitPromise: Promise<typeof globalThis.fetch> | null = null;

export async function createLibcurlFetch(wispProxyUrl: string): Promise<typeof globalThis.fetch> {
	if (libcurlInitPromise) return libcurlInitPromise;

	libcurlInitPromise = (async () => {
		const { libcurl } = await import('libcurl.js');

		if (!libcurlReady) {
			await libcurl.load_wasm(asset('/libcurl.wasm'));
			libcurlReady = true;
		}

		libcurl.set_websocket(wispProxyUrl);
		return libcurl.fetch.bind(libcurl);
	})().catch((err) => {
		libcurlInitPromise = null;
		throw err;
	});

	return libcurlInitPromise;
}

export async function resolveFetch(corsBypassEnabled?: boolean, wispProxyUrl?: string): Promise<typeof globalThis.fetch> {
	if (corsBypassEnabled && wispProxyUrl && !isTauriSync()) {
		return createLibcurlFetch(wispProxyUrl);
	}
	return fetch;
}
