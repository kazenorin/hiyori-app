import { isTauri } from '@tauri-apps/api/core';
import * as tauriHttp from '@tauri-apps/plugin-http';

let _fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis);
let initialized = false;

export function fetch(...args: Parameters<typeof globalThis.fetch>): ReturnType<typeof globalThis.fetch> {
	return _fetch(...args);
}

export function initHttpClient(): void {
	if (initialized) return;
	initialized = true;

	try {
		if (isTauri()) {
			_fetch = tauriHttp.fetch;
		}
	} catch (e) {
		console.warn('[http-client] isTauri() check failed, using globalThis.fetch', e);
	}
}
