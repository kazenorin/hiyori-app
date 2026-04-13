import { writeTextFile, readTextFile, mkdir, exists, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
import { resolveStoryFolder } from '$lib/fs/story-prompts';
import { getActiveStory } from '$lib/stores/stories.svelte';
import { getSettings } from '$lib/stores/settings.svelte';
import { log } from './logger';

function isDebugEnabled(): boolean {
	return getSettings().logLevel === 'debug';
}

function timestamp(): string {
	return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function formatEntry(label: string, content: string): string {
	const separator = '─'.repeat(60);
	return `[${timestamp()}] ${label}\n${separator}\n${content}\n${separator}\n\n`;
}

async function appendToStoryLog(
	filename: string,
	label: string,
	content: string
): Promise<void> {
	if (!isDebugEnabled()) return;
	const story = getActiveStory();
	if (!story) return;
	try {
		const folder = await resolveStoryFolder(story.id, story.name);
		await writeTextFile(`${folder}/${filename}`, formatEntry(label, content), {
			baseDir: BaseDirectory.AppData,
			append: true
		});
	} catch (err) {
		await log.error('chat-logger', `Failed to write to ${filename}`, err);
	}
}

/**
 * Log main chat context: system prompt, narration context, and all messages.
 * Called before each AI call in the main chat.
 */
export async function logMainChat(context: {
	systemPrompt: string;
	messages: Array<{ role: string; content: string }>;
}): Promise<void> {
	const parts: string[] = [];

	parts.push(`=== SYSTEM PROMPT ===\n${context.systemPrompt}`);

	const messagesStr = context.messages
		.map((m) => `--- [${m.role.toUpperCase()}] ---\n${m.content}`)
		.join('\n\n');
	parts.push(`=== MESSAGES ===\n${messagesStr}`);

	const content = parts.join('\n\n');

	// Write to story-level log file
	await appendToStoryLog('main-chat.log', 'Main Chat Context', content);

	// Also send to unified Tauri log (filtered by Rust-side level)
	await log.debug('main-chat', content);
}

/**
 * Log world builder chat context to a temporary file in AppData/logs/.
 * After story creation, the log is moved to the story folder.
 */
export async function logWorldBuilderChat(context: {
	systemPrompt: string;
	messages: Array<{ role: string; content: string }>;
	logFilename?: string;
}): Promise<void> {
	if (!isDebugEnabled()) return;

	const parts: string[] = [];

	parts.push(`=== SYSTEM PROMPT ===\n${context.systemPrompt}`);

	const messagesStr = context.messages
		.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
		.join('\n\n');
	parts.push(`=== MESSAGES ===\n${messagesStr}`);

	const content = parts.join('\n\n');

	// Also send to unified Tauri log
	await log.debug('world-builder', content);

	// Write to temp log file if filename provided
	if (context.logFilename) {
		try {
			await mkdir('logs', { baseDir: BaseDirectory.AppData, recursive: true });
			await writeTextFile(`logs/${context.logFilename}`, formatEntry('World Builder Chat Context', content), {
				baseDir: BaseDirectory.AppData,
				append: true
			});
		} catch (err) {
			await log.error('chat-logger', `Failed to write world builder log`, err);
		}
	}
}

/**
 * Move a world builder log file from AppData/logs/ to the story folder.
 */
export async function moveWorldBuilderLog(
	logFilename: string,
	storyFolder: string
): Promise<void> {
	if (!logFilename) return;
	try {
		const srcPath = `logs/${logFilename}`;
		const srcExists = await exists(srcPath, { baseDir: BaseDirectory.AppData });
		if (!srcExists) return;

		const content = await readTextFile(srcPath, { baseDir: BaseDirectory.AppData });
		await writeTextFile(`${storyFolder}/${logFilename}`, content, {
			baseDir: BaseDirectory.AppData,
			append: false
		});
		await remove(srcPath, { baseDir: BaseDirectory.AppData });
	} catch (err) {
		await log.error('chat-logger', `Failed to move world builder log`, err);
	}
}

/**
 * Generate a world builder log filename with timestamp.
 */
export function generateWorldBuilderLogFilename(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `worldbuilding-${ts}.log`;
}

/**
 * Log character card generation activity (before/after generateText calls).
 */
export async function logCharacterCardActivity(
	phase: 'extraction-start' | 'extraction-end' | 'generation-start' | 'generation-end',
	details: string
): Promise<void> {
	if (!isDebugEnabled()) return;
	await appendToStoryLog('character-cards.log', `Character Card ${phase}`, details);
}
