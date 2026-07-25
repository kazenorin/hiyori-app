import { describe, it, expect } from 'vitest';
import { applyNarrativeOverrides, mergeVariables } from '$lib/ai/pipeline/message-builder';
import { createNarrativeOverrides, type NarrativeVariables } from '$lib/ai/narrative-types';

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
