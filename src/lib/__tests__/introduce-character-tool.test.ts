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

vi.mock('$lib/db/character-profiles', () => ({
	insertCharacterProfile: vi.fn(async () => {}),
	areAnyCharacterNamesKnown: vi.fn(async () => false),
	ensurePreferredInAliases: (preferredName: string, aliases: string[]) => [preferredName, ...aliases],
	toCanonicalName: (name: string) => name,
}));

import { createIntroduceCharacterTool, buildIntroduceCharacterTools } from '$lib/ai/tools/introduce-character';
import { insertCharacterProfile, areAnyCharacterNamesKnown } from '$lib/db/character-profiles';
import type { ToolContext } from '$lib/ai/tools/tools';

function createMockContext(currentScene: number | null): ToolContext {
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
			currentScene,
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

const validInput = {
	preferredName: 'Elena',
	aliases: ['The Rogue'],
	logline: 'A wary rogue with a hidden agenda.',
	importance: 2 as const,
};

describe('createIntroduceCharacterTool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(areAnyCharacterNamesKnown).mockResolvedValue(false);
	});

	it('tags the profile with the current scene number from context', async () => {
		const toolDef = createIntroduceCharacterTool(createMockContext(5));

		const result = await toolDef.execute!(validInput, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(result).toBe('Character profile created for Elena.');
		expect(insertCharacterProfile).toHaveBeenCalledTimes(1);
		const inserted = vi.mocked(insertCharacterProfile).mock.calls[0][0];
		expect(inserted.sceneNumber).toBe(5);
		expect(inserted.actLineId).toBe('line-current');
		expect(inserted.preferredName).toBe('Elena');
	});

	it('writes a baseline (null scene) profile when there is no current scene (act-plot context)', async () => {
		const toolDef = createIntroduceCharacterTool(createMockContext(null));

		await toolDef.execute!(validInput, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(vi.mocked(insertCharacterProfile).mock.calls[0][0].sceneNumber).toBeNull();
	});

	it('rejects a character already known by name or alias without inserting', async () => {
		vi.mocked(areAnyCharacterNamesKnown).mockResolvedValue(true);
		const toolDef = createIntroduceCharacterTool(createMockContext(5));

		const result = await toolDef.execute!(validInput, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(result).toBe('tools.introduceCharacter.messages.exists');
		expect(insertCharacterProfile).not.toHaveBeenCalled();
	});
});

describe('buildIntroduceCharacterTools', () => {
	it('returns the introduce-character tool', () => {
		const tools = buildIntroduceCharacterTools(createMockContext(1));
		expect(Object.keys(tools)).toEqual(['introduce-character']);
	});
});
