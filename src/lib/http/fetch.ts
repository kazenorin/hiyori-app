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
	} else {
		await initLibcurl();
	}
}

async function initLibcurl(): Promise<void> {
	const wispUrl = getWispProxyUrl();
	if (!wispUrl) return;

	const { libcurl } = await import('libcurl.js');
	await libcurl.load_wasm('/libcurl.wasm');
	libcurl.set_websocket(wispUrl);
	_fetch = libcurl.fetch.bind(libcurl);
}

function getWispProxyUrl(): string | undefined {
	if (typeof localStorage === 'undefined') return undefined;
	try {
		const raw = localStorage.getItem('byoa-settings');
		if (!raw) return undefined;
		const settings = JSON.parse(raw);
		return settings.wispProxyUrl || undefined;
	} catch {
		return undefined;
	}
}

export async function reinitLibcurl(): Promise<void> {
	if (await checkIsTauri()) return;
	await initLibcurl();
}
