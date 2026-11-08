import { describe, it, expect } from 'vitest';
import type { CharacterProfileEntity } from '#lib/db/character-profiles.ts';
import type { SceneDetailEntry } from '#lib/definitions/pipeline-sections.ts';
import {
	buildProfileAliases,
	buildProfileDraft,
	initialAliasesText,
	initialSceneEntries,
	inspectSceneDetailEntries,
	nextSceneNumber,
	removeDisplayIndex,
	sceneDetailDisplayOrder,
	type ProfileDraftResult,
	type ProfileFormInput,
} from '#lib/components/chat/context/character-profile-form-state.ts';

function entity(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
	return {
		id: 'p1',
		actLineId: 'line-1',
		sceneNumber: 3,
		canonicalName: 'alice',
		preferredName: 'Alice',
		aliases: ['Alice', 'Al'],
		logline: 'A courier.',
		state: 'Tired.',
		goal: 'Deliver the letter.',
		relationships: 'Sister of Bob.',
		voice: 'Clipped.',
		traits: ['brave'],
		sceneDetails: '- 3: Arrives at the gate.',
		importance: 2,
		removed: false,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function input(overrides: Partial<ProfileFormInput> = {}): ProfileFormInput {
	return {
		initial: null,
		preferredName: 'Alice',
		aliasesText: '',
		logline: '',
		state: '',
		goal: '',
		relationships: '',
		voice: '',
		traitsText: '',
		importance: 4,
		sceneEntries: [],
		...overrides,
	};
}

function expectDraft(result: ProfileDraftResult) {
	if (result.error !== null) throw new Error(`Expected a draft, got error: ${result.error}`);
	return result.draft;
}

describe('alias draft building', () => {
	it('preserves the old preferred name as an alias when a character is renamed', () => {
		// Without this rule, renaming Alice drops "Alice" from aliases and breaks alias lookup.
		const draft = expectDraft(buildProfileDraft(input({ initial: entity(), preferredName: 'Alicia', aliasesText: 'Al' })));
		expect(draft.preferredName).toBe('Alicia');
		expect(draft.aliases).toEqual(['Al', 'Alice']);
	});

	it('does not re-add the preferred name when it is unchanged', () => {
		expect(buildProfileAliases(entity(), 'Alice', 'Al')).toEqual(['Al']);
		expect(buildProfileAliases(null, 'Alice', 'Al')).toEqual(['Al']);
	});

	it('seeds the alias input without the preferred name', () => {
		expect(initialAliasesText(null)).toBe('');
		expect(initialAliasesText(entity())).toBe('Al');
	});
});

describe('buildProfileDraft', () => {
	it('trims the preferred name and logline and splits/drops empty aliases and traits', () => {
		const draft = expectDraft(
			buildProfileDraft(
				input({ preferredName: '  Alice  ', aliasesText: ' Al , , Ally ', logline: ' A courier. ', traitsText: ' brave, , kind ' })
			)
		);
		expect(draft.preferredName).toBe('Alice');
		expect(draft.logline).toBe('A courier.');
		expect(draft.aliases).toEqual(['Al', 'Ally']);
		expect(draft.traits).toEqual(['brave', 'kind']);
	});

	it('settles blank optional fields to null, not empty strings', () => {
		const draft = expectDraft(buildProfileDraft(input({ state: '   ', goal: '', relationships: '\n\t', voice: '' })));
		expect(draft.state).toBeNull();
		expect(draft.goal).toBeNull();
		expect(draft.relationships).toBeNull();
		expect(draft.voice).toBeNull();
	});

	it('keeps non-blank optional fields trimmed', () => {
		const draft = expectDraft(buildProfileDraft(input({ state: ' Tired. ', goal: ' Go home. ' })));
		expect(draft.state).toBe('Tired.');
		expect(draft.goal).toBe('Go home.');
	});

	it('rejects a blank preferred name', () => {
		expect(buildProfileDraft(input({ preferredName: '   ' })).error).toBe('preferredNameRequired');
	});

	it('accepts only whitelisted importance levels', () => {
		for (const importance of [1, 2, 3, 4]) {
			expect(expectDraft(buildProfileDraft(input({ importance }))).importance).toBe(importance);
		}
		expect(buildProfileDraft(input({ importance: 5 })).error).toBe('importanceInvalid');
		expect(buildProfileDraft(input({ importance: 0 })).error).toBe('importanceInvalid');
		expect(buildProfileDraft(input({ importance: Number.NaN })).error).toBe('importanceInvalid');
	});
});

describe('scene detail validation and serialization', () => {
	it('reports invalid rows and duplicated scene numbers, sorted', () => {
		const issues = inspectSceneDetailEntries([
			{ sceneNumber: 0, details: 'bad' },
			{ sceneNumber: 2, details: 'second' },
			{ sceneNumber: 2, details: 'duplicate' },
			{ sceneNumber: Number.NaN, details: 'bad' },
		]);
		expect(issues.valid).toBe(false);
		expect(issues.invalidRows).toEqual([0, 3]);
		expect(issues.duplicateNumbers).toEqual([2]);
		expect(inspectSceneDetailEntries([{ sceneNumber: 1, details: '' }]).valid).toBe(true);
	});

	it('rejects duplicate and invalid scene numbers when building the draft', () => {
		expect(
			buildProfileDraft(
				input({
					sceneEntries: [
						{ sceneNumber: 2, details: 'a' },
						{ sceneNumber: 2, details: 'b' },
					],
				})
			).error
		).toBe('sceneDetailsInvalid');
		expect(buildProfileDraft(input({ sceneEntries: [{ sceneNumber: 0, details: 'a' }] })).error).toBe('sceneDetailsInvalid');
	});

	it('serializes entries in descending scene order and collapses multiline details', () => {
		const sceneEntries: SceneDetailEntry[] = [
			{ sceneNumber: 1, details: 'first line\nsecond line' },
			{ sceneNumber: 3, details: 'latest' },
			{ sceneNumber: 2, details: 'middle' },
		];
		const draft = expectDraft(buildProfileDraft(input({ sceneEntries })));
		expect(draft.sceneDetails).toBe('- 3: latest\n- 2: middle\n- 1: first line second line');
		expect(draft.sceneDetails.split('\n')).toHaveLength(3);
	});

	it('seeds editor rows from stored details with legacy multiline text flattened to one line', () => {
		expect(initialSceneEntries(null)).toEqual([]);
		expect(initialSceneEntries(entity({ sceneDetails: '- 2: first line\nsecond line\n- 1: single' }))).toEqual([
			{ sceneNumber: 2, details: 'first line second line' },
			{ sceneNumber: 1, details: 'single' },
		]);
	});

	it('picks the next scene number after the highest valid row', () => {
		expect(nextSceneNumber([])).toBe(1);
		expect(nextSceneNumber([{ sceneNumber: 2, details: '' }])).toBe(3);
		expect(
			nextSceneNumber([
				{ sceneNumber: Number.NaN, details: '' },
				{ sceneNumber: 5, details: '' },
			])
		).toBe(6);
	});
});

describe('scene detail display order', () => {
	it('orders valid scene numbers descending and keeps invalid rows last in input order', () => {
		const entries: SceneDetailEntry[] = [
			{ sceneNumber: Number.NaN, details: 'invalid first' },
			{ sceneNumber: 2, details: 'two' },
			{ sceneNumber: 0, details: 'invalid second' },
			{ sceneNumber: 9, details: 'nine' },
		];
		expect(sceneDetailDisplayOrder(entries)).toEqual([3, 1, 0, 2]);
	});

	it('keeps the order stable when a row scene number changes', () => {
		// Why: re-sorting on every keystroke moves the focused row, so edits can land on another
		// entry. The order is seeded once; later changes must not be re-sorted.
		const order = sceneDetailDisplayOrder([
			{ sceneNumber: 5, details: 'five' },
			{ sceneNumber: 3, details: 'three' },
			{ sceneNumber: 1, details: 'one' },
		]);
		expect(order).toEqual([0, 1, 2]);
		const edited = [
			{ sceneNumber: 1, details: 'five' },
			{ sceneNumber: 3, details: 'three' },
			{ sceneNumber: 5, details: 'one' },
		];
		expect(sceneDetailDisplayOrder(edited)).toEqual([2, 1, 0]);
		expect(order.map((index) => edited[index].details)).toEqual(['five', 'three', 'one']);
	});

	it('places a newly added max+1 row before the existing rows', () => {
		const entries: SceneDetailEntry[] = [
			{ sceneNumber: 5, details: 'five' },
			{ sceneNumber: 2, details: 'two' },
		];
		const order = sceneDetailDisplayOrder(entries);
		const added = [...entries, { sceneNumber: nextSceneNumber(entries), details: '' }];
		expect(sceneDetailDisplayOrder(added)).toEqual([added.length - 1, ...order]);
	});

	it('drops a removed row and shifts the indices after it', () => {
		expect(removeDisplayIndex([3, 1, 0, 2], 1)).toEqual([2, 0, 1]);
		expect(removeDisplayIndex([0], 0)).toEqual([]);
	});
});
