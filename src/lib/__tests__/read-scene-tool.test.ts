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

const mockDb = {
	execute: vi.fn(async () => ({ rowsAffected: 0 })),
	select: vi.fn(async (): Promise<{ role: string; content: string; scene_number: number | null }[]> => []),
};

vi.mock('$lib/db/database', () => ({
	getDatabase: () => mockDb,
}));

const mockTraceActLineChain = vi.fn(async (_actLineId: string): Promise<{ actLineId: string; actNumber: number }[]> => []);

vi.mock('$lib/db/act-lines', () => ({}));

vi.mock('$lib/db/acts', () => ({
	traceActLineChain: (actLineId: string) => mockTraceActLineChain(actLineId),
}));

vi.mock('ai', () => ({
	tool: vi.fn((def) => def),
}));

vi.mock('$lib/localization', () => ({
	ls: vi.fn((key: string, _params?: Record<string, string | number>) => key),
}));

import { createReadSceneTool, createReadDistantSceneTool, buildSceneTools } from '$lib/ai/tools/read-scene';
import type { ToolContext } from '$lib/ai/tools/tools';

function createMockContext(actNumber = 3): ToolContext {
	return {
		story: { id: 'story-1', name: 'Test Story', locale: 'en', createdAt: 0, updatedAt: 0 },
		actLine: {
			id: 'line-current',
			actId: 'act-3',
			name: 'Act 3 Main Line',
			isMainLine: true,
			createdAt: 0,
			plotMode: 'guidance',
			currentActPhase: null,
			lastPlotGeneration: null,
			actNumber,
		},
		act: {
			id: 'act-3',
			storyId: 'story-1',
			name: 'Act 3',
			actNumber,
			continuesFromActLineId: 'line-2',
			createdAt: 0,
			updatedAt: 0,
		},
	};
}

const sceneRowAssistant = { role: 'assistant', content: 'The hero entered the cave.', scene_number: 1 };
const sceneRowUser = { role: 'user', content: 'I follow the path deeper.', scene_number: 1 };

describe('createReadSceneTool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns formatted scene content when scene exists', async () => {
		mockDb.select.mockResolvedValueOnce([sceneRowAssistant, sceneRowUser]);

		const ctx = createMockContext();
		const toolDef = createReadSceneTool(ctx);

		const result = await toolDef.execute!({ sceneNumber: 1 }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(result).toContain('The hero entered the cave.');
		expect(result).toContain('I follow the path deeper.');
		expect(result).toContain('tools.readScene.headers.sceneBody');
		expect(result).toContain('tools.readScene.headers.playerResponse');
	});

	it('returns noSceneFound when scene does not exist', async () => {
		mockDb.select.mockResolvedValueOnce([]);

		const ctx = createMockContext();
		const toolDef = createReadSceneTool(ctx);

		const result = await toolDef.execute!({ sceneNumber: 99 }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(result).toBe('tools.readScene.messages.noSceneFound');
	});

	it('returns sceneNoContent when scene has no assistant or user messages', async () => {
		mockDb.select.mockResolvedValueOnce([{ role: 'system', content: 'init', scene_number: 1 }]);

		const ctx = createMockContext();
		const toolDef = createReadSceneTool(ctx);

		const result = await toolDef.execute!({ sceneNumber: 1 }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(result).toBe('tools.readScene.messages.sceneNoContent');
	});

	it('formats scene with only assistant message', async () => {
		mockDb.select.mockResolvedValueOnce([sceneRowAssistant]);

		const ctx = createMockContext();
		const toolDef = createReadSceneTool(ctx);

		const result = await toolDef.execute!({ sceneNumber: 1 }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(result).toContain('The hero entered the cave.');
		expect(result).not.toContain('I follow the path deeper.');
	});
});

describe('createReadDistantSceneTool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns formatted scene from a previous act in lineage', async () => {
		mockTraceActLineChain.mockResolvedValueOnce([
			{ actLineId: 'line-1', actNumber: 1 },
			{ actLineId: 'line-2', actNumber: 2 },
			{ actLineId: 'line-current', actNumber: 3 },
		]);
		mockDb.select.mockResolvedValueOnce([sceneRowAssistant, sceneRowUser]);

		const ctx = createMockContext(3);
		const toolDef = createReadDistantSceneTool(ctx);

		const result = await toolDef.execute!({ actNumber: 2, sceneNumber: 1 }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(mockTraceActLineChain).toHaveBeenCalledWith('line-current');
		expect(mockDb.select).toHaveBeenCalledWith(expect.any(String), ['line-2', 1]);
		expect(result).toContain('The hero entered the cave.');
		expect(result).toContain('tools.readDistantScene.headers.sceneBody');
	});

	it('returns futureAct when requesting act beyond current', async () => {
		mockTraceActLineChain.mockResolvedValueOnce([]);

		const ctx = createMockContext(3);
		const toolDef = createReadDistantSceneTool(ctx);

		const result = await toolDef.execute!({ actNumber: 5, sceneNumber: 1 }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(result).toBe('tools.readDistantScene.messages.futureAct');
	});

	it('returns actNotInLineage when act is not in chain', async () => {
		mockTraceActLineChain.mockResolvedValueOnce([
			{ actLineId: 'line-1', actNumber: 1 },
			{ actLineId: 'line-current', actNumber: 3 },
		]);

		const ctx = createMockContext(3);
		const toolDef = createReadDistantSceneTool(ctx);

		const result = await toolDef.execute!({ actNumber: 2, sceneNumber: 1 }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(result).toBe('tools.readDistantScene.messages.actNotInLineage');
	});

	it('returns noSceneFound when scene does not exist in target act', async () => {
		mockTraceActLineChain.mockResolvedValueOnce([
			{ actLineId: 'line-1', actNumber: 1 },
			{ actLineId: 'line-current', actNumber: 3 },
		]);
		mockDb.select.mockResolvedValueOnce([]);

		const ctx = createMockContext(3);
		const toolDef = createReadDistantSceneTool(ctx);

		const result = await toolDef.execute!({ actNumber: 1, sceneNumber: 99 }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(result).toBe('tools.readDistantScene.messages.noSceneFound');
	});

	it('returns sceneNoContent when scene has no readable messages', async () => {
		mockTraceActLineChain.mockResolvedValueOnce([
			{ actLineId: 'line-1', actNumber: 1 },
			{ actLineId: 'line-current', actNumber: 3 },
		]);
		mockDb.select.mockResolvedValueOnce([{ role: 'system', content: 'init', scene_number: 1 }]);

		const ctx = createMockContext(3);
		const toolDef = createReadDistantSceneTool(ctx);

		const result = await toolDef.execute!({ actNumber: 1, sceneNumber: 1 }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(result).toBe('tools.readDistantScene.messages.sceneNoContent');
	});

	it('can read from current act via lineage chain', async () => {
		mockTraceActLineChain.mockResolvedValueOnce([
			{ actLineId: 'line-1', actNumber: 1 },
			{ actLineId: 'line-current', actNumber: 3 },
		]);
		mockDb.select.mockResolvedValueOnce([sceneRowAssistant]);

		const ctx = createMockContext(3);
		const toolDef = createReadDistantSceneTool(ctx);

		const result = await toolDef.execute!({ actNumber: 3, sceneNumber: 1 }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(mockDb.select).toHaveBeenCalledWith(expect.any(String), ['line-current', 1]);
		expect(result).toContain('The hero entered the cave.');
	});
});

describe('buildSceneTools', () => {
	it('returns only read-scene when includeDistant is false', () => {
		const ctx = createMockContext();
		const tools = buildSceneTools(ctx, false);

		expect(Object.keys(tools)).toEqual(['read-scene']);
	});

	it('returns both tools when includeDistant is true', () => {
		const ctx = createMockContext();
		const tools = buildSceneTools(ctx, true);

		expect(Object.keys(tools)).toEqual(['read-scene', 'read-distant-scene']);
	});

	it('defaults includeDistant to false', () => {
		const ctx = createMockContext();
		const tools = buildSceneTools(ctx);

		expect(Object.keys(tools)).toEqual(['read-scene']);
	});
});
