/// <reference types="@sveltejs/kit" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare module 'virtual:pwa-register' {
	export interface RegisterSWOptions {
		immediate?: boolean;
		onNeedRefresh?: () => void;
		onOfflineReady?: () => void;
		onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
		onRegisterError?: (error: Error) => void;
	}
	export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
declare module 'libcurl.js' {
	interface LibcurlFetchOptions extends RequestInit {
		_libcurl_verbose?: number;
		_libcurl_http_version?: number;
		proxy?: string;
	}
	interface Libcurl {
		fetch: typeof globalThis.fetch;
		load_wasm: (url: string) => Promise<void>;
		set_websocket: (url: string) => void;
		ready: boolean;
		version: { lib: string; [key: string]: string };
	}
	export const libcurl: Libcurl;
}
declare module 'espeak-ng' {
	interface ESpeakNgFS {
		readFile(path: string, options: { encoding: 'utf8' }): string;
		readFile(path: string): Uint8Array;
	}
	interface ESpeakNgModule {
		FS: ESpeakNgFS;
	}
	interface ESpeakNgOptions {
		arguments?: string[];
		print?: (text: string) => void;
		printErr?: (text: string) => void;
	}
	export default function ESpeakNg(options?: ESpeakNgOptions): Promise<ESpeakNgModule>;
}
