import { ls } from '$lib/localization';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { WORLD_TEMPLATES } from '$lib/features/world-builder/template-registry';

export function createSelectWorldTemplateTool(onSelected: (templateId: string) => Promise<string>) {
	const templateIds = WORLD_TEMPLATES.map((t) => t.id) as [string, ...string[]];

	return tool({
		description: ls('tools.selectWorldTemplate.description'),
		inputSchema: z.object({
			templateId: z.enum(templateIds).describe(ls('tools.selectWorldTemplate.parameters.templateId')),
		}),
		execute: async ({ templateId }): Promise<string> => {
			return onSelected(templateId);
		},
	});
}

export function buildWorldBuilderTools(onSelected: (templateId: string) => Promise<string>): ToolSet {
	return {
		'select-world-template': createSelectWorldTemplateTool(onSelected),
	};
}
