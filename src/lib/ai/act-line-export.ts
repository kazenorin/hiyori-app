/**
 * Export narrative content from an act line.
 * Filters assistant messages containing narration keywords.
 * Returns only the content strings, not full message objects.
 */
export function exportActLine(messages: Array<{ role: string; content: string }>): string[] {
	const keywords = ['act', 'scene', 'session'];
	return messages
		.filter((m) => {
			if (m.role !== 'assistant') return false;
			const lowerContent = m.content.toLowerCase();
			return keywords.some((kw) => lowerContent.includes(kw));
		})
		.map((m) => m.content);
}
