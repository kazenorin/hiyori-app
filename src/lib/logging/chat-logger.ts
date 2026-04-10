import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
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
	narrationContent?: string;
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
 * Log world builder chat context: system prompt and all messages.
 * Called before each AI call in the world builder.
 */
export async function logWorldBuilderChat(context: {
	systemPrompt: string;
	messages: Array<{ role: string; content: string }>;
}): Promise<void> {
	const parts: string[] = [];

	parts.push(`=== SYSTEM PROMPT ===\n${context.systemPrompt}`);

	const messagesStr = context.messages
		.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
		.join('\n\n');
	parts.push(`=== MESSAGES ===\n${messagesStr}`);

	const content = parts.join('\n\n');

	// Write to story-level log file
	await appendToStoryLog('world-builder.log', 'World Builder Chat Context', content);

	// Also send to unified Tauri log (filtered by Rust-side level)
	await log.debug('world-builder', content);
}