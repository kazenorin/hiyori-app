import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem } from '$lib/fs/file-system';

const { mockGenerateText, mockGetMainProviderConfig, mockIsReviewerEnabled, mockCreateModel } = vi.hoisted(() => ({
	mockGenerateText: vi.fn(),
	mockGetMainProviderConfig: vi.fn(),
	mockIsReviewerEnabled: vi.fn(),
	mockCreateModel: vi.fn(),
}));

vi.mock('$lib/localization', () => ({ ls: (key: string) => key }));
vi.mock('$lib/logging/logger', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));
vi.mock('ai', () => ({ generateText: mockGenerateText, isStepCount: vi.fn(() => undefined) }));
vi.mock('$lib/stores/settings.svelte', () => ({
	getMainProviderConfig: mockGetMainProviderConfig,
	isReviewerEnabled: mockIsReviewerEnabled,
	settings: { characterProfileImportanceThreshold: 3, characterProfileMaxIncluded: 5 },
}));
vi.mock('$lib/ai/provider/provider', () => ({ createModel: mockCreateModel }));
vi.mock('$lib/fs/prompts', () => {
	const loader = { loadByStory: async () => '', loadDefault: async () => '' };
	return {
		actPlotEditorPromptLoader: loader,
		guidanceActPlotGenerationPromptLoader: loader,
		phaseEventActPlotGenerationPromptLoader: loader,
		actPlotReviewerPromptLoader: loader,
		actPlotSystemPromptLoader: loader,
		generalInstructionsLoader: loader,
		guidanceActPlotTemplateLoader: loader,
		phaseEventActPlotTemplateLoader: loader,
		interviewSummaryPromptLoader: loader,
	};
});
vi.mock('$lib/db/act-lines', () => ({
	getActLine: vi.fn(async () => null),
	getLastSceneNumber: vi.fn(async () => 1),
	getLatestActSummary: vi.fn(async () => null),
	getLatestTurnOfEvents: vi.fn(async () => null),
	getPremisesMessages: vi.fn(async () => []),
}));
vi.mock('$lib/db/acts', () => ({ getAct: vi.fn(async () => null), traceActLineChain: vi.fn(async () => []) }));
vi.mock('$lib/db/stories', () => ({ getStory: vi.fn(async () => null) }));
vi.mock('$lib/features/act-card-generator', () => ({
	checkActCardExists: vi.fn(async () => false),
	ensureActCard: vi.fn(async () => ({ content: '' })),
}));
vi.mock('$lib/fs/story-folders', () => ({ resolveStoryFolder: vi.fn(async () => '/story') }));
vi.mock('$lib/features/character-card-generator', () => ({
	ensureCharacterCard: vi.fn(async () => ({ content: '' })),
	loadLatestCharacterCardsForActLine: vi.fn(async () => []),
	toCharacterSummary: vi.fn((p) => p),
}));
vi.mock('$lib/db/character-profiles', () => ({ getLatestProfilesByActLine: vi.fn(async () => []) }));
vi.mock('$lib/ai/act-plot/tools', () => ({
	buildActPlotTools: vi.fn(() => undefined),
	filterActPlotToolsForPhase: vi.fn(() => undefined),
}));

import { generateActPlot } from '$lib/ai/act-plot/act-plot-generator';

const actLine = {
	id: 'line-1',
	actId: 'act-1',
	name: 'Main Line',
	isMainLine: true,
	createdAt: 0,
	plotMode: 'guidance',
	currentActPhase: null,
	actPhaseBoundaries: [],
	lastPlotGeneration: null,
	actNumber: 1,
	currentActPhaseLengthEstimate: null,
	currentScene: null,
} as never;

describe('generateActPlot requirements', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setFileSystem(new InMemoryFileSystem());
		mockGetMainProviderConfig.mockReturnValue({ model: 'test-model', callSettings: undefined });
		mockIsReviewerEnabled.mockReturnValue(false);
		mockCreateModel.mockResolvedValue({});
		mockGenerateText.mockResolvedValue({ text: 'PLOT BODY', usage: { totalTokens: 1 } });
	});

	it('injects the requirement lines into the writer messages', async () => {
		await generateActPlot({
			storyId: 's1',
			storyName: 'Story',
			worldContent: null,
			actLine,
			actNumber: 1,
			requirements: '- **Must:** No dragons',
		});
		const messages = mockGenerateText.mock.calls[0][0].messages as { content: string }[];
		expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('- **Must:** No dragons'))).toBe(true);
	});

	it('appends the headed requirements block to the end of the output', async () => {
		const result = await generateActPlot({
			storyId: 's1',
			storyName: 'Story',
			worldContent: null,
			actLine,
			actNumber: 1,
			requirements: '- **Must:** No dragons',
		});
		expect(result.startsWith('PLOT BODY')).toBe(true);
		expect(result.endsWith('- **Must:** No dragons')).toBe(true);
		expect(result.includes('## common.headers.requirements')).toBe(true);
	});

	it('leaves the output untouched when there are no requirements', async () => {
		const result = await generateActPlot({
			storyId: 's1',
			storyName: 'Story',
			worldContent: null,
			actLine,
			actNumber: 1,
		});
		expect(result).toBe('PLOT BODY');
	});
});
