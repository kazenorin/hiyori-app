import { describe, it, expect, vi } from 'vitest';
import {
	applyNarrativeOverrides,
	buildMainContextMessage,
	buildPhaseMessages,
	buildSummariesMessage,
	mergeVariables,
} from '$lib/ai/pipeline/message-builder';
import { createNarrativeOverrides, type NarrativeVariables } from '$lib/ai/narrative-types';

// Override only the headers these builders assert on; importOriginal keeps every other real
// export so message-builder's transitive graph (narrative-types, pipeline-sections) still links.
// sectionFormat mirrors the real impl; ls() would otherwise return raw keys (locale strings are
// not loaded in the test env), so the stubs give deterministic header text.
vi.mock('$lib/definitions/common-headers', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/definitions/common-headers')>();
	return {
		...actual,
		sectionFormat: (text: string, headerLevel = 2) => `${'#'.repeat(headerLevel)} ${text}\n\n`,
		mainContextHeader: () => 'Main Context',
		summariesHeader: () => 'Summaries',
		scenesHeader: () => 'Scenes',
		worldContentHeader: () => 'World Content',
		actPlotHeader: () => 'Act Plot',
		storySoFarHeader: () => 'Story So Far',
	};
});

const vars = (over: Partial<NarrativeVariables>): NarrativeVariables => ({
	sceneTitle: null,
	background: null,
	narrativeBody: null,
	turnOfEvents: null,
	cg: null,
	gameData: null,
	...over,
});

describe('applyNarrativeOverrides', () => {
	it('returns variables unchanged when no override is set', () => {
		const v = vars({ sceneTitle: 'Parsed', narrativeBody: 'Body' });
		const overrides = createNarrativeOverrides();

		expect(applyNarrativeOverrides(v, overrides)).toBe(v);
	});

	it('fills sceneTitle when parsed variables lack it', () => {
		const v = vars({ narrativeBody: 'Body' });
		const overrides = createNarrativeOverrides();
		overrides.sceneTitle = 'Tool Title';

		const result = applyNarrativeOverrides(v, overrides);

		expect(result?.sceneTitle).toBe('Tool Title');
		expect(result?.narrativeBody).toBe('Body');
	});

	it('keeps a parsed sceneTitle instead of the override (fill-when-missing)', () => {
		const v = vars({ sceneTitle: 'Parsed Title' });
		const overrides = createNarrativeOverrides();
		overrides.sceneTitle = 'Tool Title';

		const result = applyNarrativeOverrides(v, overrides);

		expect(result?.sceneTitle).toBe('Parsed Title');
	});

	it('fills from overrides when variables is null', () => {
		const overrides = createNarrativeOverrides();
		overrides.sceneTitle = 'Tool Title';

		const result = applyNarrativeOverrides(null, overrides);

		expect(result?.sceneTitle).toBe('Tool Title');
		expect(result?.gameData).toBeNull();
	});

	it('merges multiple override fields fill-when-missing', () => {
		const v = vars({ sceneTitle: 'Parsed Title', background: 'Parsed BG' });
		const overrides = createNarrativeOverrides();
		overrides.sceneTitle = 'Ignored Title';
		overrides.background = 'Tool BG';
		overrides.cg = 'Tool CG';

		const result = applyNarrativeOverrides(v, overrides);

		expect(result?.sceneTitle).toBe('Parsed Title');
		expect(result?.background).toBe('Parsed BG');
		expect(result?.cg).toBe('Tool CG');
	});

	it('behaves consistently with mergeVariables (overrides as fitter)', () => {
		const v = vars({ sceneTitle: 'Parsed' });
		const overrides = createNarrativeOverrides();
		overrides.sceneTitle = 'Tool';

		const direct = mergeVariables(v, { ...overrides, gameData: null });
		const viaApply = applyNarrativeOverrides(v, overrides);

		expect(viaApply).toEqual(direct);
	});
});

describe('buildSummariesMessage', () => {
	it('returns undefined when there is no summarization point', () => {
		expect(buildSummariesMessage({ summarizationPoint: 0, actSummary: 'S' })).toBeUndefined();
	});

	it('returns undefined when an SP exists but the act summary is empty', () => {
		// Why: Character Profiles no longer live here, so an empty Act Summary@SP drops the whole
		// Summaries message (the latest profiles are emitted separately, after Scenes).
		expect(buildSummariesMessage({ summarizationPoint: 8, actSummary: '' })).toBeUndefined();
	});

	it('includes the act summary section when the snapshot has content', () => {
		const msg = buildSummariesMessage({ summarizationPoint: 8, actSummary: '## Scene Summaries' });
		expect(msg).toContain('# Summaries');
	});
});

describe('buildMainContextMessage', () => {
	it('emits World Content, Story so Far (act > 1), and Act Plot in order', () => {
		const msg = buildMainContextMessage({
			worldContent: 'WORLD',
			actPlot: 'PLOT',
			previousActSummaries: [{ actNumber: 1, summary: 'Act1' }],
			actNumber: 2,
		});
		expect(msg).toContain('# Main Context');
		expect(msg.indexOf('WORLD')).toBeLessThan(msg.indexOf('PLOT'));
		expect(msg).toContain('Act1');
	});

	it('omits Story so Far in act 1 even when prior-act summaries exist', () => {
		// Why: formatStorySoFar guards on actNumber <= 1. Passing non-empty summaries proves
		// the act-number guard (not an empty array) is what suppresses the Story so Far section.
		const msg = buildMainContextMessage({
			worldContent: 'W',
			actPlot: 'P',
			previousActSummaries: [{ actNumber: 1, summary: 'Act1' }],
			actNumber: 1,
		});
		expect(msg).not.toContain('Story So Far');
		expect(msg).not.toContain('Act1');
	});
});

describe('buildPhaseMessages', () => {
	const ctx = {
		worldContent: 'W',
		actPlot: 'P',
		previousActSummaries: [],
		actNumber: 1,
		summarizationPoint: 8,
		characterProfiles: ['## Character Profiles\n\nElena'],
		actSummary: 'SUM',
		scenesSections: ['## Scene 9\n\n### Narrative Body\n\nnine'],
	};
	it('orders Main Context → Summaries → Scenes → Character Profiles → prior outputs → extraction prompt → Director Notes', () => {
		// Why: the tier order is the cache-stability contract — Tiers 0–2 (Main Context, Summaries,
		// Scenes, Character Profiles) must precede the per-phase tail so the shared prefix is
		// byte-identical. Profiles trail Scenes because they change every turn (see buildPhaseMessages).
		const msgs = buildPhaseMessages(ctx, ['## Writer Output\n\nDRAFT'], 'DO THE TASK', 'be concise');
		const joined = msgs.map((m) => m.content).join('\n');
		const idx = (s: string) => joined.indexOf(s);
		expect(idx('# Main Context')).toBeLessThan(idx('# Summaries'));
		expect(idx('# Summaries')).toBeLessThan(idx('# Scenes'));
		expect(idx('# Scenes')).toBeLessThan(idx('## Character Profiles'));
		expect(idx('## Character Profiles')).toBeLessThan(idx('DRAFT'));
		expect(idx('DRAFT')).toBeLessThan(idx('DO THE TASK'));
		expect(idx('DO THE TASK')).toBeLessThan(idx('be concise'));
	});
	it('does not place Character Profiles inside the Summaries message', () => {
		// Why: a profile snapshot pinned inside Summaries (before Scenes) confused readers and
		// shortened the cache-stable prefix; profiles are now their own section after Scenes.
		const msgs = buildPhaseMessages(ctx, [], 'TASK', '');
		const summaries = msgs.find((m) => m.content.includes('# Summaries'))?.content ?? '';
		expect(summaries).not.toContain('Elena');
	});
	it('omits the Character Profiles message when there are no profiles', () => {
		const msgs = buildPhaseMessages({ ...ctx, characterProfiles: [] }, [], 'TASK', '');
		expect(msgs.map((m) => m.content).join('\n')).not.toContain('## Character Profiles');
	});
	it('omits the Summaries message when there is no SP', () => {
		const msgs = buildPhaseMessages({ ...ctx, summarizationPoint: 0 }, [], 'TASK', '');
		expect(msgs.map((m) => m.content).join('\n')).not.toContain('# Summaries');
	});
	it('omits the Scenes message when there are no scene sections', () => {
		// Why: a header-only "# Scenes" message would sit in the shared prefix of every phase
		// carrying no information (e.g. the first scene of an act), so it must be dropped.
		const msgs = buildPhaseMessages({ ...ctx, scenesSections: [] }, [], 'TASK', '');
		expect(msgs.map((m) => m.content).join('\n')).not.toContain('# Scenes');
	});
});
