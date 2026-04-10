import {
	info as tauriInfo,
	error as tauriError,
	warn as tauriWarn,
	debug as tauriDebug,
	attachConsole
} from '@tauri-apps/plugin-log';

let attached = false;

/**
 * Attach Tauri log output to the browser DevTools console.
 * Call once during app initialization.
 */
export async function initLogging(): Promise<void> {
	if (!attached) {
		await attachConsole();
		attached = true;
	}
}

export const log = {
	info(context: string, message: string): Promise<void> {
		return tauriInfo(`[${context}] ${message}`);
	},

	error(context: string, message: string, err?: unknown): Promise<void> {
		const detail = err instanceof Error ? `${message}: ${err.message}` : message;
		return tauriError(`[${context}] ${detail}`);
	},

	warn(context: string, message: string): Promise<void> {
		return tauriWarn(`[${context}] ${message}`);
	},

	debug(context: string, message: string): Promise<void> {
		return tauriDebug(`[${context}] ${message}`);
	}
};
