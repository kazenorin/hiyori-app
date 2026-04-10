import { log } from './logger';

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

	if (context.narrationContent) {
		parts.push(`=== NARRATION CONTEXT ===\n${context.narrationContent}`);
	}

	const messagesStr = context.messages
		.map((m) => `--- [${m.role.toUpperCase()}] ---\n${m.content}`)
		.join('\n\n');
	parts.push(`=== MESSAGES ===\n${messagesStr}`);

	await log.debug('main-chat', parts.join('\n\n'));
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

	await log.debug('world-builder', parts.join('\n\n'));
}
