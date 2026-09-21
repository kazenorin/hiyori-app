import { fs } from '$lib/fs/file-system';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { getActiveStory } from '$lib/stores/stories.svelte';
import { getLogLevel, log } from './logger';
import type { UIMessage } from '$lib/ai/chat/types';

function isDebugEnabled(): boolean {
	return getLogLevel() === 'debug';
}

function timestamp(): string {
	return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function formatEntry(label: string, content: string): string {
	const separator = '─'.repeat(60);
	return `[${timestamp()}] ${label}\n${separator}\n${content}\n${separator}\n\n`;
}

async function appendToStoryLog(filename: string, label: string, content: string): Promise<void> {
	if (!isDebugEnabled()) return;
	const story = getActiveStory();
	if (!story) return;
	try {
		const folder = await resolveStoryFolder(story.id, story.name);
		await fs.writeTextFile(`${folder}/${filename}`, formatEntry(label, content), { append: true });
	} catch (err) {
		await log.error('chat-logger', `Failed to write to ${filename}`, err);
	}
}

/**
 * Log the final messages of a completed main chat run as pretty-printed JSON.
 */
export async function logMainChat(newMessages: UIMessage[]): Promise<void> {
	const entries = newMessages.map((message) => {
		const variables = message.variables;
		return {
			role: message.role,
			sceneNumber: message.sceneNumber,
			sceneTitle: variables?.sceneTitle,
			content: variables?.narrativeBody ?? message.content,
			background: variables?.background,
			cg: variables?.cg,
			turnOfEvents: variables?.turnOfEvents,
			reasoning: message.reasoning,
		};
	});
	await appendToStoryLog('main-chat.log', 'Main Chat Context', JSON.stringify(entries, null, 2));
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

	const messagesStr = context.messages.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n');
	parts.push(`=== MESSAGES ===\n${messagesStr}`);

	const content = parts.join('\n\n');

	// Write to temp log file if filename provided
	if (context.logFilename) {
		try {
			await fs.writeTextFileEnsuringDir(`logs/${context.logFilename}`, formatEntry('World Builder Chat Context', content), {
				append: true,
			});
		} catch (err) {
			await log.error('chat-logger', `Failed to write world builder log`, err);
		}
	}
}

/**
 * Move a world builder log file from AppData/logs/ to the story folder.
 */
export async function moveWorldBuilderLog(logFilename: string, storyFolder: string): Promise<void> {
	if (!logFilename) return;
	try {
		const srcPath = `logs/${logFilename}`;
		const content = await fs.readTextFileIfExists(srcPath);
		if (!content) return;

		await fs.writeTextFile(`${storyFolder}/${logFilename}`, content);
		await fs.remove(srcPath);
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

/**
 * Log act card generation activity (before/after generateText calls).
 */
export async function logActCardActivity(phase: 'generation-start' | 'generation-end', details: string): Promise<void> {
	if (!isDebugEnabled()) return;
	await appendToStoryLog('act-cards.log', `Act Card ${phase}`, details);
}
