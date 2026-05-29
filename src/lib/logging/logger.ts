import { attachConsole, debug as tauriDebug, error as tauriError, info as tauriInfo, warn as tauriWarn } from '@tauri-apps/plugin-log';
import { getFileSystem } from '$lib/fs/file-system';
import { kebabCase } from 'lodash-es';
import { getSettings, LOG_LEVEL_VALUES, type LogLevel } from '$lib/stores/settings.svelte';

const fileFs = getFileSystem();

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

function safeLog(fn: (msg: string) => Promise<void>, level: string, msg: string): Promise<void> {
	return fn(msg).catch(() => {
		console.log(`[${level}] ${msg}`);
	});
}

export const log = {
	info(context: string, message: string): Promise<void> {
		return safeLog(tauriInfo, 'info', `[${context}] ${message}`);
	},

	error(context: string, message: string, err?: unknown): Promise<void> {
		const detail = `${message}: ${parseErrorMessage(err)}`;
		return safeLog(tauriError, 'error', `[${context}] ${detail}`);
	},

	warn(context: string, message: string): Promise<void> {
		return safeLog(tauriWarn, 'warn', `[${context}] ${message}`);
	},

	debug(context: string, message: string): Promise<void> {
		return safeLog(tauriDebug, 'debug', `[${context}] ${message}`);
	},
};

export async function fileLog(level: LogLevel, loggerTag: string, message: string | (() => string)): Promise<void> {
	const settingsLevel = LOG_LEVEL_VALUES[getSettings().logLevel];
	const incomingLevel = LOG_LEVEL_VALUES[level];
	if (incomingLevel > settingsLevel) return;

	const resolvedMessage = typeof message === 'function' ? message() : message;
	const line = `[${fileLogTimestamp()}] [${level.toUpperCase()}] ${resolvedMessage}\n`;
	const filename = `${kebabCase(loggerTag)}.log`;
	try {
		await fileFs.writeTextFileEnsuringDir(`logs/${filename}`, line, { append: true });
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
