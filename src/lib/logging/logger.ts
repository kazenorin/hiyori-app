import { checkIsTauri } from '$lib/runtime';
import { getFileSystem } from '$lib/fs/file-system';
import { kebabCase } from 'lodash-es';
import { getSettings, LOG_LEVEL_VALUES, type LogLevel } from '$lib/stores/settings.svelte';

let fileFs: ReturnType<typeof getFileSystem>;

function getFileFs() {
	if (fileFs) return fileFs;
	try {
		fileFs = getFileSystem();
		return fileFs;
	} catch {
		return null;
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
	if (await checkIsTauri()) {
		const tauriLog = await import('@tauri-apps/plugin-log');
		await tauriLog.attachConsole();
		logInfo = (msg: string) => safeTauriLog(tauriLog.info, msg);
		logError = (msg: string) => safeTauriLog(tauriLog.error, msg);
		logWarn = (msg: string) => safeTauriLog(tauriLog.warn, msg);
		logDebug = (msg: string) => safeTauriLog(tauriLog.debug, msg);
	}
}

function safeTauriLog(fn: (msg: string) => Promise<void>, msg: string): Promise<void> {
	return fn(msg).catch(() => {
		console.log(msg);
	});
}

function writeToConsole(level: string, msg: string): Promise<void> {
	const fns: Record<string, (m: string) => void> = { error: console.error, warn: console.warn, info: console.info, debug: console.debug };
	fns[level]?.(msg);
	return Promise.resolve();
}

async function logWeb(level: string, message: string): Promise<void> {
	// noinspection ES6MissingAwait
	writeToConsole(level, message);

	return (
		(await getFileFs()
			?.writeTextFileEnsuringDir(`logs/app.log`, `[${fileLogTimestamp()}] [${level.toUpperCase()}] ${message}\n`, {
				append: true,
			})
			.catch(() => {})) ?? Promise.resolve()
	);
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
		await getFileFs()?.writeTextFileEnsuringDir(`logs/${filename}`, line, { append: true });
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
