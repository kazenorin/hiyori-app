import { checkIsTauri, isTauriSync } from '$lib/runtime';

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
	}
}

let libcurlReady = false;

export async function createLibcurlFetch(wispProxyUrl: string): Promise<typeof globalThis.fetch> {
	const { libcurl } = await import('libcurl.js');

	if (!libcurlReady) {
		await libcurl.load_wasm('/libcurl.wasm');
		libcurlReady = true;
	}

	libcurl.set_websocket(wispProxyUrl);
	return libcurl.fetch.bind(libcurl);
}

export async function resolveFetch(corsBypassEnabled?: boolean, wispProxyUrl?: string): Promise<typeof globalThis.fetch> {
	if (corsBypassEnabled && wispProxyUrl && !isTauriSync()) {
		return createLibcurlFetch(wispProxyUrl);
	}
	return fetch;
}
