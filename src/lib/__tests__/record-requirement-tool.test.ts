import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
	tool: vi.fn((def) => def),
}));

vi.mock('$lib/localization', () => ({
	ls: vi.fn((key: string) => key),
}));

import { createRecordRequirementTool, buildRequirementTools } from '$lib/ai/tools/record-requirement';
import type { RequirementCategory } from '$lib/definitions/requirements';

const callCtx = { toolCallId: 'test', messages: [], abortSignal: undefined, context: {} } as never;

describe('createRecordRequirementTool', () => {
	const onRecord = vi.fn(async (_category: RequirementCategory, _requirement: string) => 'tools.recordRequirement.messages.success');

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('delegates the parsed category + requirement to onRecord and returns its result', async () => {
		const toolDef = createRecordRequirementTool(onRecord);
		const result = await toolDef.execute!({ category: 'mustNot', requirement: 'No dragons' }, callCtx);
		expect(onRecord).toHaveBeenCalledWith('mustNot', 'No dragons');
		expect(result).toBe('tools.recordRequirement.messages.success');
	});

	it('accepts every valid modal-verb category', () => {
		const toolDef = createRecordRequirementTool(onRecord);
		const parse = (cat: string) => toolDef.inputSchema.safeParse({ category: cat, requirement: 'x' });
		for (const cat of ['must', 'should', 'may', 'mustNot', 'will']) {
			expect(parse(cat).success).toBe(true);
		}
	});

	it('rejects an unknown category via the zod schema', () => {
		const toolDef = createRecordRequirementTool(onRecord);
		expect(toolDef.inputSchema.safeParse({ category: 'might', requirement: 'x' }).success).toBe(false);
	});
});

describe('buildRequirementTools', () => {
	it('exposes the tool under the record-requirement key', () => {
		const tools = buildRequirementTools(async () => 'ok');
		expect(Object.keys(tools)).toEqual(['record-requirement']);
	});
});
