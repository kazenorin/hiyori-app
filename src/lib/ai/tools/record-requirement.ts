import { ls } from '$lib/localization';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { REQUIREMENT_CATEGORIES, type RequirementCategory } from '$lib/definitions/requirements';

export type RecordRequirementHandler = (category: RequirementCategory, requirement: string) => Promise<string>;

export function createRecordRequirementTool(onRecord: RecordRequirementHandler) {
	return tool({
		description: ls('tools.recordRequirement.description'),
		inputSchema: z.object({
			category: z.enum(REQUIREMENT_CATEGORIES).describe(ls('tools.recordRequirement.parameters.category')),
			requirement: z.string().describe(ls('tools.recordRequirement.parameters.requirement')),
		}),
		execute: async ({ category, requirement }): Promise<string> => {
			return onRecord(category, requirement);
		},
	});
}

export function buildRequirementTools(onRecord: RecordRequirementHandler): ToolSet {
	return {
		'record-requirement': createRecordRequirementTool(onRecord),
	};
}
