import type { Message } from '$lib/db/messages';
import { backgroundHeader, narrativeBodyHeader } from '$lib/definitions/common-headers';

/**
 * Export narrative content from an act line.
 * Extracts background and narrative body from assistant messages, formatting each
 * with H3 headers. Falls back to `content` for legacy rows that predate the streaming parser.
 * Returns one formatted string per assistant message, suitable as individual user messages.
 */
export function exportActLine(messages: Message[]): string[] {
	return messages
		.filter((m) => m.role === 'assistant')
		.map((m) => formatNarrativeEntry(m))
		.filter((c) => c.trim().length > 0);
}

function formatNarrativeEntry(m: Message): string {
	const vars = m.variables;
	const background = vars?.background?.trim();
	const narrativeBody = vars?.narrativeBody?.trim();

	if (!background && !narrativeBody) {
		return m.content;
	}

	const parts: string[] = [];
	if (background) {
		parts.push(`### ${backgroundHeader()}\n\n${background}`);
	}
	if (narrativeBody) {
		parts.push(`### ${narrativeBodyHeader()}\n\n${narrativeBody}`);
	}
	return parts.join('\n\n');
}
