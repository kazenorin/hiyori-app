import type { NarrativeVariables } from '$lib/ai/narrative-types';
import { hasTemplateMetadata } from '$lib/ai/template-renderer';

export function buildTTSPassage(variables: NarrativeVariables | undefined, fallbackContent: string | undefined): string {
	if (variables && hasTemplateMetadata(variables)) {
		const parts: string[] = [];

		if (variables.sceneTitle) {
			parts.push(stripFormatting(variables.sceneTitle));
		}

		if (variables.background) {
			parts.push(stripFormatting(variables.background));
		}

		if (variables.narrativeBody) {
			parts.push(stripFormatting(variables.narrativeBody));
		}

		if (variables.turnOfEvents) {
			parts.push(stripFormatting(variables.turnOfEvents));
		}

		if (variables.cg) {
			parts.push(stripFormatting(variables.cg));
		}

		return parts.join('\n\n');
	}

	if (fallbackContent) {
		return stripFormatting(fallbackContent);
	}

	return '';
}

export function stripFormatting(text: string): string {
	return text
		.replace(/<[^>]+>/g, '')
		.replace(/^[-*_]{3,}$/gm, '')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\*{3}(.+?)\*{3}/g, '$1')
		.replace(/\*{2}(.+?)\*{2}/g, '$1')
		.replace(/\*(.+?)\*/g, '$1')
		.replace(/_{2}(.+?)_{2}/g, '$1')
		.replace(/\b_(.+?)_\b/g, '$1')
		.replace(/~~(.+?)~~/g, '$1')
		.replace(/`(.+?)`/g, '$1')
		.replace(/^>\s+/gm, '')
		.replace(/^[-*]\s+/gm, '')
		.replace(/^\d+\.\s+/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
