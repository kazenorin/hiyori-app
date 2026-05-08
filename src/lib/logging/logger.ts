import { attachConsole, debug as tauriDebug, error as tauriError, info as tauriInfo, warn as tauriWarn } from '@tauri-apps/plugin-log';
import { BaseDirectory, mkdir, writeTextFile } from '@tauri-apps/plugin-fs';
import { kebabCase } from 'lodash-es';
import { getSettings, LOG_LEVEL_VALUES, type LogLevel } from '$lib/stores/settings.svelte';

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
		const detail = `${message}: ${parseErrorMessage(err)}`;
		return tauriError(`[${context}] ${detail}`);
	},

	warn(context: string, message: string): Promise<void> {
		return tauriWarn(`[${context}] ${message}`);
	},

	debug(context: string, message: string): Promise<void> {
		return tauriDebug(`[${context}] ${message}`);
	},
};

export async function fileLog(level: LogLevel, loggerTag: string, message: string): Promise<void> {
	const settingsLevel = LOG_LEVEL_VALUES[getSettings().logLevel];
	const incomingLevel = LOG_LEVEL_VALUES[level];
	if (incomingLevel > settingsLevel) return;

	const line = `[${fileLogTimestamp()}] [${level.toUpperCase()}] ${message}\n`;
	const filename = `${kebabCase(loggerTag)}.log`;
	try {
		await mkdir('logs', { baseDir: BaseDirectory.AppData, recursive: true });
		await writeTextFile(`logs/${filename}`, line, {
			baseDir: BaseDirectory.AppData,
			append: true,
		});
	} catch {
		// Silent fail — file logging is best-effort
	}
}

function parseErrorMessage(err?: unknown): string {
	if (err instanceof Error) {
		return err.message;
	} else if (typeof err === 'string') {
		return err;
	} else {
		try {
			return String(err);
		} catch {
			return 'unknown error';
		}
	}
}

function fileLogTimestamp(): string {
	return new Date().toISOString().replace('T', ' ').replace('Z', '');
}
