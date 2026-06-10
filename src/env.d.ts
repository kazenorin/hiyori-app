/// <reference types="@sveltejs/kit" />
/// <reference types="vite/client" />
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

declare module 'kokoro-js' {
	interface KokoroTTSOptions {
		dtype?: string;
		device?: string | null;
		progress_callback?: ((progress: { status?: string; progress?: number }) => void) | null;
	}

	interface GenerateOptions {
		voice?: string;
		speed?: number;
	}

	interface RawAudio {
		audio: Float32Array;
		sampleRate: number;
	}

	export class KokoroTTS {
		constructor(model: unknown, tokenizer: unknown);
		static from_pretrained(modelId: string, options?: KokoroTTSOptions): Promise<KokoroTTS>;
		generate(text: string, options?: GenerateOptions): Promise<RawAudio>;
		voices: Record<string, unknown>;
	}
}
