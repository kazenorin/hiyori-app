import { isTauri } from '@tauri-apps/api/core';
import * as tauriLog from '@tauri-apps/plugin-log';
import { getFileSystem } from '$lib/fs/file-system';
import { kebabCase } from 'lodash-es';
import { getSettings, LOG_LEVEL_VALUES, type LogLevel } from '$lib/stores/settings.svelte';

const fileFs = getFileSystem();

function checkIsTauri() {
	try {
		return isTauri();
	} catch {
		return false;
	}
}

let logInfo = (msg: string) => logWeb('info', msg);
let logError = (msg: string) => logWeb('error', msg);
let logWarn = (msg: string) => logWeb('warn', msg);
let logDebug = (msg: string) => logWeb('debug', msg);

/**
 * Attach Tauri log output to the browser DevTools console.
 * Call once during app initialization. No-op in web environments.
 */
export async function initLogging(): Promise<void> {
	if (checkIsTauri()) {
		await tauriLog.attachConsole();
		logInfo = (msg: string) => tauriLog.info(msg);
		logError = (msg: string) => tauriLog.error(msg);
		logWarn = (msg: string) => tauriLog.warn(msg);
		logDebug = (msg: string) => tauriLog.debug(msg);
	}
}

function writeToConsole(level: string, msg: string): Promise<void> {
	const fns: Record<string, (m: string) => void> = { error: console.error, warn: console.warn, info: console.info, debug: console.debug };
	fns[level]?.(msg);
	return Promise.resolve();
}

async function logWeb(level: string, message: string): Promise<void> {
	// noinspection ES6MissingAwait
	writeToConsole(level, message);

	return await fileFs
		.writeTextFileEnsuringDir(`logs/app.log`, `[${fileLogTimestamp()}] [${level.toUpperCase()}] ${message}\n`, {
			append: true,
		})
		.catch(() => {});
}

export const log = {
	info(context: string, message: string): Promise<void> {
		return logInfo(`[${context}] ${message}`);
	},

	error(context: string, message: string, err?: unknown): Promise<void> {
		const detail = `${message}: ${parseErrorMessage(err)}`;
		return logError(`[${context}] ${detail}`);
	},

	warn(context: string, message: string): Promise<void> {
		return logWarn(`[${context}] ${message}`);
	},

	debug(context: string, message: string): Promise<void> {
		return logDebug(`[${context}] ${message}`);
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
