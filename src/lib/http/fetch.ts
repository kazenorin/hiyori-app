import { checkIsTauri } from '$lib/runtime';

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
