import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

/**
 * Unlike writer-prompt-context.test.ts, this file does NOT mock `$lib/localization`: the
 * assertions here compare prompt text against the real header labels the pipeline emits, so
 * `ls()` must return real values. loadLocaleStrings() falls back to the bundled YAML when the
 * Tauri filesystem is absent (the case under vitest), which logs one warning and works.
 */
vi.mock('$lib/stores/settings.svelte', () => ({
	isReviewerEnabled: () => true,
	isQuickReview: () => false,
	isPlotPlannerEnabled: () => true,
	getReevaluationFrequency: () => 5,
	isMemoryAvailable: () => false,
	isInventoryAvailable: () => false,
	isPhraseHighlightingEnabled: () => false,
}));

vi.mock('$lib/logging/logger', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));

vi.mock('$lib/ai/tools/tools', () => ({
	guardToolsForPhase: (tools: unknown) => tools,
}));

vi.mock('$lib/ai/pipeline/phase-executor', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/ai/pipeline/phase-executor')>();
	return { ...actual, executeStreamingPhase: vi.fn() };
});

import { executeStreamingPhase } from '$lib/ai/pipeline/phase-executor';
import { loadLocaleStrings } from '$lib/localization';
import { runWriterPhase, type PipelineRunContext, type TrackPhase } from '$lib/ai/pipeline/runners';
import {
	writerDirectorNotesReinforcementPhrase,
	writerScenePrioritiesHeader,
	writerTurnOfEventsReinforcementPhrase,
} from '$lib/definitions/pipeline-prompts';
import type { ActLineContext, PipelineState } from '$lib/ai/pipeline/types';
import type { StreamResultMetadata } from '$lib/ai/streaming';
import { createNarrativeOverrides } from '$lib/ai/narrative-types';

const executeStreamingPhaseMock = vi.mocked(executeStreamingPhase);

const LOCALES = ['en', 'zh-Hant-HK'] as const;
type Locale = (typeof LOCALES)[number];

const ROLE_HEADING: Record<Locale, string> = { en: '# Your Role', 'zh-Hant-HK': '# 你的角色' };

function makeMetadata(): StreamResultMetadata {
	return { finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, durationMs: 10, models: new Set(['m']) };
}

/**
 * Mirrors how src/lib/fs/prompts.ts bundles the assets (eager `?raw` glob), so the test reads the
 * exact text that ships. The exported PromptLoader interface only exposes async load methods, and
 * LocalizedPromptFile.getDefaultContent is private to createLoader, so the glob is the synchronous
 * route to the bundled content.
 */
const WRITER_PROMPT_FILES = import.meta.glob('../fs/*/prompts/writer/*.md', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

function promptFile(locale: Locale, name: string): string {
	const key = `../fs/${locale}/prompts/writer/${name}.md`;
	const text = WRITER_PROMPT_FILES[key];
	if (text === undefined) throw new Error(`bundled writer prompt not found: ${key}`);
	return text;
}

/** Real bundled prompt text, with no AppData or filesystem dependency. */
function writerPrompts(locale: Locale) {
	return {
		writerRole: promptFile(locale, 'writer-role'),
		guidanceWriterExtractionPrompt: promptFile(locale, 'guidance-writer-extraction-prompt'),
		phaseEventWriterExtractionPrompt: promptFile(locale, 'phase-event-writer-extraction-prompt'),
		epilogueWriterExtractionPrompt: promptFile(locale, 'epilogue-writer-extraction-prompt'),
		writerOutputTemplate: promptFile(locale, 'writer-output-template'),
	};
}

/** Headings only, with code fences stripped so the embedded template's own headers are not counted. */
function headingsOutsideFences(text: string): string[] {
	let inFence = false;
	return text
		.split('\n')
		.filter((line) => {
			if (/^```/.test(line.trim())) inFence = !inFence;
			return !inFence && /^#{1,4}\s/.test(line);
		})
		.map((line) => line.trim());
}

function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

interface RenderOptions {
	locale: Locale;
	plotMode: 'guidance' | 'phaseEvent';
	epilogueEndingType?: string;
	summarizationPoint?: number;
	previousTurnOfEvents?: string;
	directorNotes?: string;
}

function makeCtx(opts: RenderOptions): PipelineRunContext {
	return {
		sharedParams: {
			abortSignal: new AbortController().signal,
			callbacks: {
				onPhaseStart: vi.fn(),
				onPhaseStream: vi.fn(),
				onPhaseRetry: vi.fn(),
				onPhaseComplete: vi.fn(),
				onError: vi.fn(),
				onAllComplete: vi.fn(),
			},
			retryConfig: { retryCount: 0, backoffIntervalSeconds: 0 },
		},
		providerConfigs: {
			plotPlanner: undefined,
			writer: undefined,
			reviewer: undefined,
			editor: undefined,
			gameMaster: undefined,
			summarizer: undefined,
			minorTaskAgent: undefined,
		},
		prompts: {
			generalInstructions: '',
			mainChatSystemPrompt: '',
			reviewerExtractionPrompt: '',
			quickReviewerExtractionPrompt: '',
			editorExtractionPrompt: '',
			guidancePlotPlannerExtractionPrompt: '',
			phaseEventPlotPlannerExtractionPrompt: '',
			guidanceGameMasterExtractionPrompt: '',
			phaseEventGameMasterExtractionPrompt: '',
			...writerPrompts(opts.locale),
		},
		effectiveTargetWordCount: '400',
		currentScene: '8',
		completedScenes: 7,
		directorNotes: opts.directorNotes ?? '',
		previousTurnOfEvents: opts.previousTurnOfEvents,
		previousScenePlot: 'previous plot',
		tools: undefined,
		story: {
			storyId: 'story-1',
			storyName: 'Story',
			actLine: {
				id: 'line-1',
				actId: 'act-1',
				name: 'Main Line',
				isMainLine: true,
				createdAt: 0,
				plotMode: opts.plotMode,
				currentActPhase: null,
				actPhaseBoundaries: [],
				lastPlotGeneration: null,
				actNumber: 1,
				currentActPhaseLengthEstimate: null,
				currentScene: 8,
			} as ActLineContext,
		},
		assistant: { messageId: 'msg-1', messageSequence: 1 },
		narrativeOverrides: createNarrativeOverrides(),
		context: {
			worldContent: '',
			actPlot: '',
			previousActSummaries: [],
			summarizationPoint: opts.summarizationPoint ?? 0,
			characterProfiles: [],
			actSummaryAtSP: '',
			scenesSections: [],
			plotMode: opts.plotMode,
		},
	};
}

/**
 * Render the real writer tail by driving runWriterPhase with the real bundled prompt files
 * injected. Mirrors renderWriterMessages() in writer-prompt-context.test.ts, but returns only
 * the extraction-prompt message rather than every message joined.
 */
async function renderTail(opts: RenderOptions): Promise<string> {
	let rendered: { content: string }[] = [];
	executeStreamingPhaseMock.mockImplementation(async (params, state) => {
		rendered = params.messages as { content: string }[];
		return {
			state: { ...state } as PipelineState,
			streamState: { content: '', reasoning: null, variables: null },
			metadata: makeMetadata(),
		};
	});
	const trackPhase: TrackPhase = (_phaseName, result) => result.state;
	await runWriterPhase(makeCtx(opts), {}, trackPhase, opts.epilogueEndingType);
	// With worldContent/actPlot/scenes/profiles all empty the shared prefix contributes no
	// messages, so the tail is the extraction prompt plus a Director's Notes message when set.
	const tail = rendered.map((m) => m.content).find((c) => c.includes(ROLE_HEADING[opts.locale]));
	if (tail === undefined) throw new Error('extraction prompt not found in writer messages');
	return tail;
}

describe('writer prompt assembly', () => {
	beforeAll(async () => {
		await loadLocaleStrings('en');
	});

	beforeEach(() => {
		executeStreamingPhaseMock.mockReset();
	});

	it.each(LOCALES)('%s: every prompt file resolves to non-empty bundled content', (locale) => {
		for (const [name, text] of Object.entries(writerPrompts(locale))) {
			expect(text.trim().length, name).toBeGreaterThan(0);
		}
	});

	it('en and zh prompt files have the same heading shape', () => {
		// Structural parity: same heading count and same levels, compared positionally.
		const en = writerPrompts('en');
		const zh = writerPrompts('zh-Hant-HK');
		for (const key of Object.keys(en) as (keyof typeof en)[]) {
			const enLevels = headingsOutsideFences(en[key]).map((h) => h.match(/^#+/)![0]);
			const zhLevels = headingsOutsideFences(zh[key]).map((h) => h.match(/^#+/)![0]);
			expect(zhLevels, key).toEqual(enLevels);
		}
	});

	it.each(LOCALES)('%s: renders a writer tail with every placeholder resolved', async (locale) => {
		for (const plotMode of ['guidance', 'phaseEvent'] as const) {
			const tail = await renderTail({ locale, plotMode, summarizationPoint: 5 });
			expect(tail, plotMode).not.toMatch(/{{\w+}}/);
			expect(countOccurrences(tail, ROLE_HEADING[locale]), plotMode).toBe(1);
		}
	});

	/**
	 * The evidence map is the writer's addressable referent for grounding. A name the runtime
	 * never emits makes the writer confidently describe content that was never sent — the class
	 * of defect fixed in commit 1b90e50.
	 */
	it.each(LOCALES)('%s: guidance evidence map names only sections the runtime can emit', (locale) => {
		// KNOWN LIMITATION: these allow-lists are hand-copied from common.headers.* rather than read
		// via ls(), because the suite loads only the 'en' locale and the zh file names are literal text
		// in the markdown. This catches a prompt-side rename (the 世界背景 class of bug fixed in
		// 1b90e50); it does NOT catch a header renamed in zh-Hant-HK.yaml. Re-check the lists whenever
		// a common.headers.* value changes.
		const allowed =
			locale === 'en'
				? ['# World Content', '# Story So Far', '# Act Plot', '# Act Summary', '# Scenes', '# Upcoming Scene Plot', '## Character Profiles']
				: ['# 世界觀內容', '# 故事回顧', '# 章節劇情', '# 章節摘要', '# 場景', '# 下一場景劇情', '## 角色檔案'];
		const guidance = writerPrompts(locale).guidanceWriterExtractionPrompt;
		const map = guidance
			.split('\n')
			.filter((l) => l.startsWith('- `#'))
			.join('\n');
		const named = [...map.matchAll(/`#{1,2} [^`]+`/g)].map((m) => m[0].slice(1, -1));
		expect(named.length).toBeGreaterThan(0);
		for (const name of named) expect(allowed, name).toContain(name);
	});

	/**
	 * The story's `# Act Plot` message states each phase's purpose story-specifically, so the
	 * writer's generic table is redundant — and it named only 4 of the 5 phases the runtime
	 * defines, with labels that did not match what {{currentActPhase}} substitutes to.
	 */
	it.each(LOCALES)('%s: phase-event prompt carries no generic phase-purpose table', (locale) => {
		const text = writerPrompts(locale).phaseEventWriterExtractionPrompt;
		expect(text).not.toContain(locale === 'en' ? 'Phase Core Purposes' : '階段核心目的參考');
		expect(text).not.toMatch(/^\|/m);
	});

	/**
	 * writerRole and one variant are concatenated into a single message, so a section present in
	 * both is paid for twice. The role's copy of the cast rules is the stricter one ("ALWAYS use
	 * names from the tool / DO NOT invent"); the variant copies were weaker *and* later in the
	 * message, where recency favours them.
	 */
	it.each(LOCALES)('%s: character-introduction rules appear exactly once in the assembled prompt', async (locale) => {
		const heading = locale === 'en' ? '### Introducing Characters' : '### 角色引入';
		for (const plotMode of ['guidance', 'phaseEvent'] as const) {
			const tail = await renderTail({ locale, plotMode });
			expect(countOccurrences(tail, heading), plotMode).toBe(1);
			expect(countOccurrences(tail, 'suggest-character-name'), plotMode).toBe(1);
			expect(countOccurrences(tail, 'introduce-character'), plotMode).toBe(2);
		}
	});

	/**
	 * Every retrieval tool belongs to the role's single tool list; the variants keep only the
	 * caveat that depends on {{previousScene}}, which the role cannot know.
	 */
	it.each(LOCALES)('%s: retrieval-tool guidance has one home in the assembled prompt', (locale) => {
		expect(writerPrompts(locale).writerRole).toContain('read-distant-scene');
		for (const variant of ['guidanceWriterExtractionPrompt', 'phaseEventWriterExtractionPrompt'] as const) {
			expect(writerPrompts(locale)[variant]).not.toContain('read-distant-scene');
		}
	});

	/**
	 * The field guidance moves to the always-present role (one authoring site for all three
	 * variants) while each variant keeps `## Output Format` — the mandate plus the fenced template —
	 * last, because that is the position nearest generation. Distinct heading names keep the two
	 * concerns from colliding in one message.
	 */
	it.each(LOCALES)('%s: output field guidance appears exactly once, in the role', async (locale) => {
		const fields = locale === 'en' ? '## Output Fields' : '## 輸出欄位';
		const format = locale === 'en' ? '## Output Format' : '## 輸出格式';
		const cgLine = locale === 'en' ? 'Visual Novel style artwork description' : '視覺小說風格的插圖描述';
		expect(countOccurrences(writerPrompts(locale).writerRole, fields)).toBe(1);
		for (const plotMode of ['guidance', 'phaseEvent'] as const) {
			const tail = await renderTail({ locale, plotMode });
			expect(countOccurrences(tail, fields), plotMode).toBe(1);
			expect(countOccurrences(tail, format), plotMode).toBe(1);
			expect(countOccurrences(tail, cgLine), plotMode).toBe(1);
			expect(tail.trimEnd().endsWith('```'), plotMode).toBe(true);
		}
	});

	/**
	 * The Director's Notes reinforcement is "absolute priority" per the role's first rule, yet it
	 * used to render as an indented sub-bullet of a *tool instruction* line. One named slot, right
	 * after the evidence map, gives all three priorities coherent salience.
	 */
	it.each(LOCALES)('%s: priority block sits after the evidence map and before the output format', async (locale) => {
		// Derived from ls(), not hardcoded: the header is the one heading in this block that the
		// pipeline injects at runtime, so it follows whichever locale the test environment loaded.
		const heading = `## ${writerScenePrioritiesHeader()}`;
		const profiles = locale === 'en' ? '## Character Profiles' : '## 角色檔案';
		const format = locale === 'en' ? '## Output Format' : '## 輸出格式';
		for (const plotMode of ['guidance', 'phaseEvent'] as const) {
			const tail = await renderTail({
				locale,
				plotMode,
				directorNotes: 'Keep the ending bleak.',
				previousTurnOfEvents: 'The bridge collapsed behind them.',
			});
			const at = tail.indexOf(heading);
			expect(at, plotMode).toBeGreaterThan(tail.indexOf(profiles));
			expect(tail.indexOf(format), plotMode).toBeGreaterThan(at);
			// Assert the phrase CONTENT arrives, not a line count: the block sits in the middle of a
			// long prompt, so slicing heading-to-Output-Format and counting non-blank lines would pass
			// even if the block were empty. Expected strings come from ls() so they cannot drift from
			// the YAML the way a hard-coded literal would.
			const directorPhrase = writerDirectorNotesReinforcementPhrase().trim();
			expect(tail, `${plotMode} director's-notes phrase`).toContain(directorPhrase);
			expect(tail, `${plotMode} turn-of-events phrase`).toContain(writerTurnOfEventsReinforcementPhrase().trim());
			const phraseAt = tail.indexOf(directorPhrase);
			expect(phraseAt, plotMode).toBeGreaterThan(at);
			expect(phraseAt, plotMode).toBeLessThan(tail.indexOf(format, at));
		}
	});

	/**
	 * substituteToolsLine removes the whole placeholder line when the value is empty, satisfying the
	 * project convention that an empty templated value leaves no orphan line behind. Whitespace-only
	 * lines are the failure mode; genuinely empty lines are acceptable.
	 *
	 * Phase-event mode only: resolveActEndInstruction returns the end-of-act instruction
	 * unconditionally in guidance mode, so "no priority applies" is unreachable there.
	 */
	it.each(LOCALES)('%s: nothing is left behind when no priority applies', async (locale) => {
		const tail = await renderTail({ locale, plotMode: 'phaseEvent' });
		expect(tail).not.toContain(writerScenePrioritiesHeader());
		expect(tail).not.toMatch(/{{\w+}}/);
		expect(tail).not.toMatch(/^[ \t]+$/m);
	});

	/**
	 * The epilogue's own Grounding check already tells the writer to trace facts to
	 * `## Character Profiles`, but its evidence sentence never named that section — and the role
	 * bullet can only defer to a per-task enumeration if every task actually carries one.
	 */
	it.each(LOCALES)('%s: epilogue evidence map covers Character Profiles', (locale) => {
		const text = writerPrompts(locale).epilogueWriterExtractionPrompt;
		const profiles = locale === 'en' ? '`## Character Profiles`' : '`## 角色檔案`';
		const upcoming = locale === 'en' ? 'Upcoming Scene Plot' : '下一場景劇情';
		expect(text).toContain(profiles);
		// upcomingScenePlot is undefined for the epilogue, so the map must not claim it.
		expect(text).not.toContain(upcoming);
		expect(text.split('\n').filter((l) => l.startsWith('- `#')).length).toBeGreaterThanOrEqual(3);
	});

	it.each(LOCALES)('%s: role grounding bullet defers to the task enumeration', (locale) => {
		const role = writerPrompts(locale).writerRole;
		const prefix = locale === 'en' ? '- **Grounding:**' : '- **根據脈絡:**';
		const grounding = role.split('\n').find((l) => l.startsWith(prefix));
		expect(grounding, 'grounding bullet').toBeDefined();
		expect(grounding).not.toContain(locale === 'en' ? 'World Content' : '世界觀內容');
	});

	/** The epilogue gained five placeholders with its evidence map, so it needs render coverage too. */
	it.each(LOCALES)('%s: epilogue tail resolves every placeholder', async (locale) => {
		const tail = await renderTail({ locale, plotMode: 'guidance', epilogueEndingType: 'bittersweet', summarizationPoint: 5 });
		expect(tail).not.toMatch(/{{\w+}}/);
		expect(countOccurrences(tail, ROLE_HEADING[locale])).toBe(1);
		expect(tail).toContain('bittersweet');
		expect(tail).not.toMatch(/^[ \t]+$/m);
	});
});
