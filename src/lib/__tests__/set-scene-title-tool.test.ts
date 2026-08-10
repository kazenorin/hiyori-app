import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async () => {}),
}));

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

vi.mock('ai', () => ({
	tool: vi.fn((def) => def),
}));

vi.mock('$lib/localization', () => ({
	ls: vi.fn((key: string, _params?: Record<string, string | number>) => key),
}));

import { createSetSceneTitleTool, buildSetSceneTitleTools } from '$lib/ai/tools/set-scene-title';
import type { ToolContext } from '$lib/ai/tools/tools';
import { createNarrativeOverrides } from '$lib/ai/narrative-types';

function createMockContext(): ToolContext {
	return {
		story: { id: 'story-1', name: 'Test Story', locale: 'en', createdAt: 0, updatedAt: 0 },
		actLine: {
			id: 'line-current',
			actId: 'act-1',
			name: 'Act 1 Main Line',
			isMainLine: true,
			createdAt: 0,
			plotMode: 'guidance',
			currentActPhase: null,
			actPhaseBoundaries: [],
			lastPlotGeneration: null,
			actNumber: 1,
			currentActPhaseLengthEstimate: null,
			currentScene: null,
		},
		act: {
			id: 'act-1',
			storyId: 'story-1',
			name: 'Act 1',
			actNumber: 1,
			continuesFromActLineId: null,
			createdAt: 0,
			updatedAt: 0,
		},
	};
}

describe('createSetSceneTitleTool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('writes the title into the overrides container and returns a success result', async () => {
		const ctx = createMockContext();
		const overrides = createNarrativeOverrides();
		const toolDef = createSetSceneTitleTool(ctx, overrides);

		const result = await toolDef.execute!(
			{ title: 'The Cave Entrance' },
			{ toolCallId: 'test', messages: [], abortSignal: undefined, context: {} }
		);

		expect(overrides.sceneTitle).toBe('The Cave Entrance');
		expect(result).toEqual({ result: 'tools.setSceneTitle.messages.success' });
	});

	it('trims whitespace from the title', async () => {
		const ctx = createMockContext();
		const overrides = createNarrativeOverrides();
		const toolDef = createSetSceneTitleTool(ctx, overrides);

		await toolDef.execute!({ title: '  Whitespace Title  ' }, { toolCallId: 'test', messages: [], abortSignal: undefined, context: {} });

		expect(overrides.sceneTitle).toBe('Whitespace Title');
	});

	it('overwrites a previously set title on subsequent calls', async () => {
		const ctx = createMockContext();
		const overrides = createNarrativeOverrides();
		overrides.sceneTitle = 'Old Title';
		const toolDef = createSetSceneTitleTool(ctx, overrides);

		await toolDef.execute!({ title: 'New Title' }, { toolCallId: 'test', messages: [], abortSignal: undefined, context: {} });

		expect(overrides.sceneTitle).toBe('New Title');
	});

	it('only sets sceneTitle, leaving other override fields null', async () => {
		const ctx = createMockContext();
		const overrides = createNarrativeOverrides();
		const toolDef = createSetSceneTitleTool(ctx, overrides);

		await toolDef.execute!({ title: 'Only Title' }, { toolCallId: 'test', messages: [], abortSignal: undefined, context: {} });

		expect(overrides.sceneTitle).toBe('Only Title');
		expect(overrides.background).toBeNull();
		expect(overrides.narrativeBody).toBeNull();
		expect(overrides.turnOfEvents).toBeNull();
		expect(overrides.cg).toBeNull();
	});
});

describe('buildSetSceneTitleTools', () => {
	it('returns the set-scene-title tool', () => {
		const ctx = createMockContext();
		const overrides = createNarrativeOverrides();
		const tools = buildSetSceneTitleTools(ctx, overrides);

		expect(Object.keys(tools)).toEqual(['set-scene-title']);
	});
});
