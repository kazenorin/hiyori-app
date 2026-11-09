import { describe, it, expect } from 'vitest';
import type { CharacterProfileEntity } from '#lib/db/character-profiles.ts';
import {
	findSavedProfile,
	formatSceneDetailsAscending,
	shouldShowCompressionWarning,
} from '#lib/components/chat/context/character-profile-panel-state.ts';

function entity(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
	return {
		id: 'p1',
		actLineId: 'line-1',
		sceneNumber: 3,
		canonicalName: 'alice',
		preferredName: 'Alice',
		aliases: ['Alice'],
		logline: '',
		state: null,
		goal: null,
		relationships: null,
		voice: null,
		traits: [],
		sceneDetails: '',
		importance: 4,
		removed: false,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe('findSavedProfile', () => {
	it('matches a same-scene edit by id even when the name changed', () => {
		const previous = entity();
		const saved = entity({ id: 'p1', preferredName: 'Alicia' });
		expect(findSavedProfile([entity({ id: 'p9' }), saved], previous, 'Alicia')).toBe(saved);
	});

	it('matches an edit copy by canonical identity when the id changed', () => {
		// Editing a baseline or earlier version writes a new id, so the id cannot identify the save.
		const previous = entity({ id: 'p1' });
		const copy = entity({ id: 'p2', sceneNumber: 4, preferredName: 'Alicia' });
		expect(findSavedProfile([entity({ id: 'p9', canonicalName: 'bob', preferredName: 'Bob' }), copy], previous, 'Alicia')).toBe(copy);
	});

	it('matches an add by the trimmed submitted preferred name', () => {
		const added = entity({ id: 'p2', preferredName: 'Bob' });
		expect(findSavedProfile([entity(), added], null, '  Bob  ')).toBe(added);
	});

	it('returns null when the saved version is absent', () => {
		expect(findSavedProfile([], null, 'Bob')).toBeNull();
		expect(findSavedProfile([entity({ id: 'p9', canonicalName: 'bob', preferredName: 'Bob' })], entity(), 'Alice')).toBeNull();
	});
});

describe('formatSceneDetailsAscending', () => {
	it('reorders descending stored details oldest first', () => {
		expect(formatSceneDetailsAscending('- 9: late\n- 2: early')).toBe('- 2: early\n- 9: late');
	});

	it('returns legacy freeform text trimmed', () => {
		expect(formatSceneDetailsAscending('  freeform notes  ')).toBe('freeform notes');
	});

	it('returns an empty string for blank details', () => {
		expect(formatSceneDetailsAscending('   ')).toBe('');
	});
});

describe('shouldShowCompressionWarning', () => {
	it('warns when the compressor is enabled and has not run for the selected scene', () => {
		expect(shouldShowCompressionWarning(27, 25, 5)).toBe(true);
	});

	it('warns when the compressor is enabled and has never run', () => {
		expect(shouldShowCompressionWarning(3, null, 5)).toBe(true);
	});

	it('stays quiet at the compression point', () => {
		expect(shouldShowCompressionWarning(25, 25, 5)).toBe(false);
	});

	it('stays quiet when the compressor is disabled', () => {
		// Why: a disabled compressor never overwrites edits, so the warning would be false.
		expect(shouldShowCompressionWarning(27, 25, 0)).toBe(false);
		expect(shouldShowCompressionWarning(3, null, -1)).toBe(false);
	});
});
