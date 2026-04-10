import { mkdir, exists, readTextFile, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { log } from './logger';

const LOGS_DIR = 'logs';
const MAIN_CHAT_LOG = 'logs/main-chat.log';
const WORLD_BUILDER_LOG = 'logs/world-builder.log';

let logsDirEnsured = false;

async function ensureLogsDir(): Promise<void> {
	if (logsDirEnsured) return;
	await mkdir(LOGS_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
	logsDirEnsured = true;
}

function timestamp(): string {
	return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function formatEntry(level: string, label: string, content: string): string {
	const separator = '─'.repeat(60);
	return `[${timestamp()}] [${level}] ${label}\n${separator}\n${content}\n${separator}\n\n`;
}

async function appendToLog(filePath: string, entry: string): Promise<void> {
	await ensureLogsDir();
	try {
		const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData });
		const existing = fileExists ? await readTextFile(filePath, { baseDir: BaseDirectory.AppData }) : '';
		await writeTextFile(filePath, existing + entry, { baseDir: BaseDirectory.AppData });
	} catch (err) {
		log.error('chat-logger', `Failed to write to ${filePath}`, err);
	}
}

/**
 * Log main chat context: system prompt, narration context, and all messages.
 * Called before each AI call in the main chat.
 */
export async function logMainChat(context: {
	systemPrompt: string;
	narrationContent?: string;
	messages: Array<{ role: string; content: string }>;
}): Promise<void> {
	const parts: string[] = [];

	parts.push(`SYSTEM PROMPT:\n${context.systemPrompt}`);

	if (context.narrationContent) {
		parts.push(`NARRATION CONTEXT (hidden):\n${context.narrationContent}`);
	}

	const messagesStr = context.messages
		.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
		.join('\n\n');
	parts.push(`MESSAGES:\n${messagesStr}`);

	await appendToLog(MAIN_CHAT_LOG, formatEntry('DEBUG', 'Main Chat Context', parts.join('\n\n')));
}

/**
 * Log world builder chat context: system prompt and all messages.
 * Called before each AI call in the world builder.
 */
export async function logWorldBuilderChat(context: {
	systemPrompt: string;
	messages: Array<{ role: string; content: string }>;
}): Promise<void> {
	const parts: string[] = [];

	parts.push(`SYSTEM PROMPT:\n${context.systemPrompt}`);

	const messagesStr = context.messages
		.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
		.join('\n\n');
	parts.push(`MESSAGES:\n${messagesStr}`);

	await appendToLog(WORLD_BUILDER_LOG, formatEntry('DEBUG', 'World Builder Chat Context', parts.join('\n\n')));
}
