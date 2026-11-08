import { describe, it, expect } from 'vitest';
import type { CharacterProfileEntity } from '#lib/db/character-profiles.ts';
import type { SceneDetailEntry } from '#lib/definitions/pipeline-sections.ts';
import {
	buildProfileAliases,
	buildProfileDraft,
	buildSceneDetailRows,
	initialAliases,
	initialSceneEntries,
	inspectSceneDetailEntries,
	type ProfileDraftResult,
	type ProfileFormInput,
	type SceneDetailRow,
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
		aliases: [],
		logline: '',
		state: '',
		goal: '',
		relationships: '',
		voice: '',
		traits: [],
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
		const draft = expectDraft(buildProfileDraft(input({ initial: entity(), preferredName: 'Alicia', aliases: ['Al'] })));
		expect(draft.preferredName).toBe('Alicia');
		expect(draft.aliases).toEqual(['Al', 'Alice']);
	});

	it('does not re-add the preferred name when it is unchanged', () => {
		expect(buildProfileAliases(entity(), 'Alice', ['Al'])).toEqual(['Al']);
		expect(buildProfileAliases(null, 'Alice', ['Al'])).toEqual(['Al']);
	});

	it('seeds alias tags from the stored array without the preferred name', () => {
		expect(initialAliases(null)).toEqual([]);
		expect(initialAliases(entity({ aliases: ['Alice', 'Al', 'Ali'] }))).toEqual(['Al', 'Ali']);
	});
});

describe('buildProfileDraft', () => {
	it('trims the preferred name and logline and drops blank aliases and traits', () => {
		const draft = expectDraft(
			buildProfileDraft(
				input({ preferredName: '  Alice  ', aliases: [' Al ', '  ', 'Ally '], logline: ' A courier. ', traits: [' brave ', ' ', 'kind'] })
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
});

describe('scene detail row ranges', () => {
	const entriesAt = (numbers: number[]): SceneDetailEntry[] =>
		numbers.map((sceneNumber) => ({ sceneNumber, details: `scene ${sceneNumber}` }));

	function entryRow(rows: SceneDetailRow[], sceneNumber: number) {
		const row = rows.find((candidate) => candidate.kind === 'entry' && candidate.sceneNumber === sceneNumber);
		if (!row || row.kind !== 'entry') throw new Error(`No entry row for scene ${sceneNumber}`);
		return row;
	}

	function addRows(rows: SceneDetailRow[]) {
		return rows.filter((row): row is Extract<SceneDetailRow, { kind: 'add' }> => row.kind === 'add');
	}

	it('matches the review example: latest 10 with entries 9, 8, 7, 4, 2, 1', () => {
		const rows = buildSceneDetailRows(entriesAt([9, 8, 7, 4, 2, 1]), 10);

		expect(rows[0]).toMatchObject({ kind: 'add', range: { min: 10, max: 10 } });
		expect(entryRow(rows, 9).range).toEqual({ min: 9, max: 9 });
		expect(entryRow(rows, 8).range).toEqual({ min: 8, max: 8 });
		expect(entryRow(rows, 7).range).toEqual({ min: 5, max: 7 });
		expect(rows[4]).toMatchObject({ kind: 'add', range: { min: 5, max: 6 } });
		expect(entryRow(rows, 4).range).toEqual({ min: 4, max: 4 });
		expect(rows[6]).toMatchObject({ kind: 'add', range: { min: 3, max: 3 } });
		expect(entryRow(rows, 2).range).toEqual({ min: 2, max: 2 });
		expect(entryRow(rows, 1).range).toEqual({ min: 1, max: 1 });
		expect(rows.map((row) => (row.kind === 'entry' ? row.sceneNumber : `add:${row.range.min}-${row.range.max}`))).toEqual([
			'add:10-10',
			9,
			8,
			7,
			'add:5-6',
			4,
			'add:3-3',
			2,
			1,
		]);
	});

	it('offers a single add row across the whole range when no entries exist', () => {
		expect(buildSceneDetailRows([], 10)).toEqual([{ kind: 'add', key: expect.any(String), range: { min: 1, max: 10 } }]);
	});

	it('offers no add rows when every scene up to the latest exists', () => {
		const rows = buildSceneDetailRows(entriesAt([4, 3, 2, 1]), 4);
		expect(rows).toHaveLength(4);
		expect(addRows(rows)).toEqual([]);
		expect(rows.every((row) => row.kind === 'entry' && row.range.min === row.range.max)).toBe(true);
	});

	it('fills the gaps above the highest and below the lowest entry', () => {
		const rows = buildSceneDetailRows(entriesAt([5, 4]), 10);
		const adds = addRows(rows).map((row) => row.range);
		expect(adds).toEqual([
			{ min: 6, max: 10 },
			{ min: 1, max: 3 },
		]);
	});

	it('widens the lowest entry downward only when the gap below has two or more scenes', () => {
		// Gap 1..3 has three scenes, so the lowest entry can shift inside it.
		expect(entryRow(buildSceneDetailRows(entriesAt([5, 4]), 10), 4).range).toEqual({ min: 1, max: 4 });
		// Gap 1..2 has two scenes; scene 3's row can still shift.
		expect(entryRow(buildSceneDetailRows(entriesAt([3]), 10), 3).range).toEqual({ min: 1, max: 3 });
	});

	it('keeps a fixed scene when its upper gap has only one free scene', () => {
		// Between 9 and 7 only scene 8 is free, so the add row owns it and 9 stays fixed.
		const rows = buildSceneDetailRows(entriesAt([9, 7]), 10);
		expect(entryRow(rows, 9).range).toEqual({ min: 9, max: 9 });
		expect(addRows(rows).map((row) => row.range)).toEqual([
			{ min: 10, max: 10 },
			{ min: 8, max: 8 },
			{ min: 1, max: 6 },
		]);
	});

	it('shows entries above the latest scene as fixed rows without offering a gap above them', () => {
		const rows = buildSceneDetailRows(entriesAt([12, 9]), 10);
		expect(rows[0]).toMatchObject({ kind: 'entry', sceneNumber: 12, range: { min: 12, max: 12 } });
		expect(addRows(rows).map((row) => row.range)).toEqual([
			{ min: 10, max: 10 },
			{ min: 1, max: 8 },
		]);
	});
});
