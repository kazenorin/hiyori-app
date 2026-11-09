import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from './helpers/test-database';
import { runMigrations } from '#lib/db/migrations.ts';

let testDb: ReturnType<typeof createTestDatabase>;

vi.mock('#lib/db/database.ts', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

import {
	insertCharacterProfile,
	getProfilesAtScene,
	type CharacterImportance,
	type CharacterProfileEntity,
} from '#lib/db/character-profiles.ts';
import {
	DuplicateProfileError,
	consolidateProfiles,
	loadProfileContext,
	mergeProfileContent,
	removeProfile,
	saveProfile,
	type ProfileDraft,
} from '#lib/features/character-profile-context.ts';

const LINE = 'line-1';
let counter = 0;

function entity(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
	counter += 1;
	const preferredName = overrides.preferredName ?? `Character ${counter}`;
	return {
		id: `p${counter}`,
		actLineId: LINE,
		sceneNumber: 1,
		canonicalName: preferredName.toLowerCase().replace(/\s+/g, '-'),
		preferredName,
		aliases: [preferredName],
		logline: `Logline ${counter}`,
		state: null,
		goal: null,
		relationships: null,
		voice: null,
		traits: [],
		sceneDetails: '',
		importance: 2,
		removed: false,
		createdAt: 1000 + counter,
		updatedAt: 1000 + counter,
		...overrides,
	};
}

async function seedScene(actLineId: string, sceneNumber: number): Promise<void> {
	const messageId = `msg-${actLineId}-${sceneNumber}`;
	await testDb.execute('INSERT INTO messages (id, role, content, scene_number, created_at) VALUES ($1, $2, $3, $4, $5)', [
		messageId,
		'assistant',
		'',
		sceneNumber,
		1000 + sceneNumber,
	]);
	await testDb.execute('INSERT INTO act_lines (act_line_id, message_id, sequence) VALUES ($1, $2, $3)', [
		actLineId,
		messageId,
		sceneNumber,
	]);
}

async function rawRow(id: string): Promise<Record<string, unknown> | null> {
	const rows = await testDb.select<Record<string, unknown>[]>('SELECT * FROM character_profiles WHERE id = $1', [id]);
	return rows[0] ?? null;
}

async function seedCompression(actLineId: string, sceneNumber: number): Promise<void> {
	await testDb.execute(
		`INSERT INTO act_line_events (id, act_line_id, message_sequence, event, value, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		[
			`compression-${actLineId}-${sceneNumber}`,
			actLineId,
			sceneNumber,
			'character-profiles-compressed',
			String(sceneNumber),
			2000 + sceneNumber,
		]
	);
}

async function rawCount(): Promise<number> {
	const rows = await testDb.select<{ total: number }[]>('SELECT COUNT(*) AS total FROM character_profiles');
	return rows[0].total;
}

function draftFrom(profile: CharacterProfileEntity, overrides: Partial<ProfileDraft> = {}): ProfileDraft {
	return {
		preferredName: profile.preferredName,
		aliases: [...profile.aliases],
		logline: profile.logline,
		state: profile.state,
		goal: profile.goal,
		relationships: profile.relationships,
		voice: profile.voice,
		traits: [...profile.traits],
		sceneDetails: profile.sceneDetails,
		importance: profile.importance,
		...overrides,
	};
}

function addDraft(overrides: Partial<ProfileDraft> = {}): ProfileDraft {
	return {
		preferredName: 'Elena',
		aliases: ['Elena'],
		logline: 'A wandering hero.',
		state: null,
		goal: null,
		relationships: null,
		voice: null,
		traits: [],
		sceneDetails: '',
		importance: 2,
		...overrides,
	};
}

describe('character profile context operations', () => {
	beforeEach(async () => {
		counter = 0;
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	describe('loadProfileContext', () => {
		it('loads the scene snapshot and only marks the latest scene editable', async () => {
			await seedScene(LINE, 1);
			await seedScene(LINE, 2);
			await insertCharacterProfile(
				entity({ id: 'scene-1', sceneNumber: 1, preferredName: 'Elena', canonicalName: 'elena', logline: 'Scene 1 Elena' })
			);
			await insertCharacterProfile(
				entity({ id: 'scene-2', sceneNumber: 2, preferredName: 'Elena', canonicalName: 'elena', logline: 'Scene 2 Elena' })
			);

			const historical = await loadProfileContext(LINE, 1);
			expect(historical.profiles.map((p) => p.id)).toEqual(['scene-1']);
			expect(historical.profiles[0].logline).toBe('Scene 1 Elena');
			expect(historical.editable).toBe(false);

			const latest = await loadProfileContext(LINE, 2);
			expect(latest.profiles.map((p) => p.id)).toEqual(['scene-2']);
			expect(latest.editable).toBe(true);

			expect((await loadProfileContext(LINE, 5)).editable).toBe(false);
		});

		it('is not editable when the act line has no scenes', async () => {
			expect(await loadProfileContext('empty-line', 1)).toEqual({ profiles: [], editable: false, lastCompressionScene: null });
		});

		it('includes the latest character-profile compression scene', async () => {
			await seedScene(LINE, 1);
			await seedScene(LINE, 2);
			await seedCompression(LINE, 1);
			await seedCompression(LINE, 2);

			expect((await loadProfileContext(LINE, 2)).lastCompressionScene).toBe(2);
		});

		it('reports no compression point when the compressor has never run', async () => {
			await seedScene(LINE, 1);

			expect((await loadProfileContext(LINE, 1)).lastCompressionScene).toBeNull();
		});
	});

	describe('saveProfile', () => {
		it('adds a profile at the latest scene with normalized names, traits and required text', async () => {
			await seedScene(LINE, 2);

			await saveProfile(
				LINE,
				2,
				null,
				addDraft({
					preferredName: '  Elena  ',
					aliases: [' Elena ', 'Shadow', 'Shadow', '  '],
					logline: '  A wandering hero.  ',
					traits: [' bold ', '', 'bold', 'cunning'],
					sceneDetails: '- 2: Arrives\ncontinued',
				})
			);

			const profiles = await getProfilesAtScene(LINE, 2);
			expect(profiles).toHaveLength(1);
			const profile = profiles[0];
			expect(profile.preferredName).toBe('Elena');
			expect(profile.aliases).toEqual(['Elena', 'Shadow']);
			expect(profile.canonicalName).toBe('elena');
			expect(profile.logline).toBe('A wandering hero.');
			expect(profile.traits).toEqual(['bold', 'cunning']);
			expect(profile.sceneDetails).toBe('- 2: Arrives continued');
			expect(profile.sceneNumber).toBe(2);
			expect(profile.removed).toBe(false);
			expect(profile.createdAt).toBe(profile.updatedAt);
		});

		it('revives a tombstoned identity for Add while active identities keep precedence', async () => {
			await seedScene(LINE, 1);
			await seedScene(LINE, 2);
			const erased = entity({
				id: 'erased',
				sceneNumber: 1,
				preferredName: 'Elena',
				canonicalName: 'lady-shadowcrest',
				aliases: ['Elena', 'Shadow'],
			});
			await insertCharacterProfile(erased);

			// Existing winner selection breaks scene/created_at ties without a clock tiebreak, so
			// give the erase and each Add a distinct timestamp instead of racing the wall clock.
			vi.useFakeTimers();
			try {
				vi.setSystemTime(100_000);
				await removeProfile(LINE, 2, erased, 'context');
				expect(await getProfilesAtScene(LINE, 2)).toEqual([]);
				expect((await rawRow('erased'))?.removed).toBe(0);

				vi.setSystemTime(200_000);
				await saveProfile(LINE, 2, null, addDraft({ preferredName: 'Elena', aliases: ['Shadow'] }));
				const revived = (await getProfilesAtScene(LINE, 2))[0];
				expect(revived.canonicalName).toBe('lady-shadowcrest');
				expect(revived.id).not.toBe('erased');
				expect(revived.removed).toBe(false);

				// The revived identity now owns "Shadow"; Add for an active identity must be rejected
				// rather than creating a shadowed duplicate row at the same scene.
				vi.setSystemTime(300_000);
				await expect(saveProfile(LINE, 2, null, addDraft({ preferredName: 'Shadow', aliases: ['Shadow'] }))).rejects.toBeInstanceOf(
					DuplicateProfileError
				);
				expect(await getProfilesAtScene(LINE, 2)).toHaveLength(1);
			} finally {
				vi.useRealTimers();
			}
		});

		it('rejects adding a duplicate of an active character by preferred name or derived canonical name', async () => {
			await seedScene(LINE, 2);
			await saveProfile(LINE, 2, null, addDraft({ preferredName: 'Elena', aliases: ['Elena', 'Shadow'] }));

			await expect(saveProfile(LINE, 2, null, addDraft({ preferredName: 'Elena' }))).rejects.toBeInstanceOf(DuplicateProfileError);
			await expect(saveProfile(LINE, 2, null, addDraft({ preferredName: 'Elena', aliases: ['Shadow'] }))).rejects.toBeInstanceOf(
				DuplicateProfileError
			);
			expect(await getProfilesAtScene(LINE, 2)).toHaveLength(1);
		});

		it('edits a selected-scene row in place, preserving identity, creation time and untouched fields', async () => {
			await seedScene(LINE, 2);
			const original = entity({
				id: 'e1',
				sceneNumber: 2,
				preferredName: 'Elena',
				canonicalName: 'elena',
				aliases: ['Elena', 'E'],
				logline: 'Old logline',
				state: 'Old state',
				goal: 'Old goal',
				relationships: 'Old relationships',
				voice: 'Old voice',
				traits: ['bold'],
				sceneDetails: '- 2: Old detail',
				createdAt: 1000,
				updatedAt: 1000,
			});
			await insertCharacterProfile(original);

			await saveProfile(LINE, 2, original, draftFrom(original, { logline: 'New logline', state: 'New state' }));

			const row = await rawRow('e1');
			expect(row?.scene_number).toBe(2);
			expect(row?.created_at).toBe(1000);
			expect(row?.updated_at).toBeGreaterThan(1000);
			expect(row?.canonical_name).toBe('elena');
			expect(row?.logline).toBe('New logline');
			expect(row?.state).toBe('New state');
			expect(row?.goal).toBe('Old goal');
			expect(row?.relationships).toBe('Old relationships');
			expect(row?.voice).toBe('Old voice');
			expect(row?.traits).toBe('bold');
			expect(row?.scene_details).toBe('- 2: Old detail');
			expect(row?.removed).toBe(0);
			expect(await rawCount()).toBe(1);
		});

		it('copies an earlier or baseline row into the selected scene with a fresh id', async () => {
			await seedScene(LINE, 1);
			await seedScene(LINE, 2);
			const baseline = entity({
				id: 'base',
				sceneNumber: null,
				preferredName: 'Elena',
				canonicalName: 'lady-shadowcrest',
				aliases: ['Elena', 'Shadow'],
				logline: 'Baseline logline',
				state: 'Baseline state',
				createdAt: 500,
				updatedAt: 500,
			});
			await insertCharacterProfile(baseline);

			await saveProfile(LINE, 2, baseline, draftFrom(baseline, { logline: 'Selected scene edit' }));

			const sceneTwo = (await getProfilesAtScene(LINE, 2))[0];
			expect(sceneTwo.id).not.toBe('base');
			expect(sceneTwo.sceneNumber).toBe(2);
			expect(sceneTwo.canonicalName).toBe('lady-shadowcrest');
			expect(sceneTwo.logline).toBe('Selected scene edit');
			expect(sceneTwo.state).toBe('Baseline state');
			expect(sceneTwo.createdAt).toBeGreaterThan(500);
			expect(sceneTwo.updatedAt).toBeGreaterThan(500);

			const baselineRow = await rawRow('base');
			expect(baselineRow?.scene_number).toBeNull();
			expect(baselineRow?.logline).toBe('Baseline logline');
			expect(baselineRow?.updated_at).toBe(500);
			expect(await rawCount()).toBe(2);
		});
	});

	describe('removeProfile', () => {
		it('deletes a selected-scene profile entry and reveals the older version', async () => {
			await seedScene(LINE, 1);
			await seedScene(LINE, 2);
			const earlier = entity({ id: 'v1', sceneNumber: 1, preferredName: 'Elena', canonicalName: 'elena', logline: 'Earlier' });
			const current = entity({ id: 'v2', sceneNumber: 2, preferredName: 'Elena', canonicalName: 'elena', logline: 'Current' });
			await insertCharacterProfile(earlier);
			await insertCharacterProfile(current);

			await removeProfile(LINE, 2, current, 'entry');

			expect(await rawRow('v2')).toBeNull();
			expect((await getProfilesAtScene(LINE, 2)).map((p) => p.id)).toEqual(['v1']);
		});

		it('refuses to delete an earlier or baseline profile entry', async () => {
			await seedScene(LINE, 2);
			const earlier = entity({ id: 'v1', sceneNumber: 1 });
			await insertCharacterProfile(earlier);

			await expect(removeProfile(LINE, 2, earlier, 'entry')).rejects.toThrow(/belongs to scene 1|erase .* from context/i);
			expect(await rawRow('v1')).not.toBeNull();
		});

		it('erases a selected-scene profile from context in place', async () => {
			await seedScene(LINE, 2);
			const current = entity({
				id: 'v2',
				sceneNumber: 2,
				preferredName: 'Elena',
				canonicalName: 'elena',
				logline: 'Current',
				createdAt: 1000,
				updatedAt: 1000,
			});
			await insertCharacterProfile(current);

			await removeProfile(LINE, 2, current, 'context');

			const row = await rawRow('v2');
			expect(row?.removed).toBe(1);
			expect(row?.scene_number).toBe(2);
			expect(row?.canonical_name).toBe('elena');
			expect(row?.preferred_name).toBe('Elena');
			expect(row?.updated_at).toBeGreaterThan(1000);
			expect(await rawCount()).toBe(1);
			expect(await getProfilesAtScene(LINE, 2)).toEqual([]);
		});

		it('erases an earlier or baseline profile from context with a selected-scene tombstone', async () => {
			await seedScene(LINE, 1);
			await seedScene(LINE, 2);
			const earlier = entity({
				id: 'v1',
				sceneNumber: 1,
				preferredName: 'Elena',
				canonicalName: 'elena',
				aliases: ['Elena', 'Shadow'],
				createdAt: 1000,
				updatedAt: 1000,
			});
			await insertCharacterProfile(earlier);

			await removeProfile(LINE, 2, earlier, 'context');

			const tombstones = await testDb.select<Record<string, unknown>[]>('SELECT * FROM character_profiles WHERE removed = 1');
			expect(tombstones).toHaveLength(1);
			expect(tombstones[0].id).not.toBe('v1');
			expect(tombstones[0].scene_number).toBe(2);
			expect(tombstones[0].canonical_name).toBe('elena');
			expect(tombstones[0].preferred_name).toBe('Elena');
			expect(tombstones[0].aliases).toBe(JSON.stringify(['Elena', 'Shadow']));
			expect(tombstones[0].updated_at).toBeGreaterThan(1000);
			expect((await rawRow('v1'))?.removed).toBe(0);
			expect(await getProfilesAtScene(LINE, 2)).toEqual([]);
			expect(await rawCount()).toBe(2);
		});
	});

	describe('mutation guards', () => {
		it('rejects mutations at a historical scene without changing rows', async () => {
			await seedScene(LINE, 1);
			await seedScene(LINE, 2);
			await seedScene(LINE, 3);
			const current = entity({
				id: 'v2',
				sceneNumber: 2,
				preferredName: 'Elena',
				canonicalName: 'elena',
				createdAt: 1000,
				updatedAt: 1000,
			});
			const other = entity({
				id: 'v2b',
				sceneNumber: 2,
				preferredName: 'Voss',
				canonicalName: 'voss',
				createdAt: 1100,
				updatedAt: 1100,
			});
			await insertCharacterProfile(current);
			await insertCharacterProfile(other);

			await expect(saveProfile(LINE, 2, null, addDraft({ preferredName: 'Mira', aliases: ['Mira'] }))).rejects.toThrow(
				/no rows were changed/i
			);
			await expect(saveProfile(LINE, 2, current, draftFrom(current, { logline: 'Rewritten' }))).rejects.toThrow(/no rows were changed/i);
			await expect(removeProfile(LINE, 2, current, 'context')).rejects.toThrow(/no rows were changed/i);
			await expect(removeProfile(LINE, 2, current, 'entry')).rejects.toThrow(/no rows were deleted/i);
			await expect(consolidateProfiles(LINE, 2, current, [other])).rejects.toThrow(/no rows were changed/i);

			expect((await rawRow('v2'))?.logline).toBe(current.logline);
			expect((await rawRow('v2'))?.removed).toBe(0);
			expect((await rawRow('v2b'))?.removed).toBe(0);
			expect(await rawCount()).toBe(2);
		});

		it('rejects a stale observed version so concurrent edits cannot overwrite each other', async () => {
			await seedScene(LINE, 2);
			const current = entity({
				id: 'v2',
				sceneNumber: 2,
				preferredName: 'Elena',
				canonicalName: 'elena',
				logline: 'First',
				createdAt: 1000,
				updatedAt: 1000,
			});
			await insertCharacterProfile(current);
			const stale = { ...current, updatedAt: 999 };

			await expect(saveProfile(LINE, 2, stale, draftFrom(stale, { logline: 'Stale edit' }))).rejects.toThrow(/no rows were changed/i);
			await expect(removeProfile(LINE, 2, stale, 'context')).rejects.toThrow(/no rows were changed/i);
			await expect(removeProfile(LINE, 2, stale, 'entry')).rejects.toThrow(/no rows were deleted/i);

			expect((await rawRow('v2'))?.logline).toBe('First');
			expect((await rawRow('v2'))?.updated_at).toBe(1000);
		});
	});

	describe('mergeProfileContent', () => {
		const rankCases: {
			name: string;
			destination: Partial<CharacterProfileEntity>;
			sources: Partial<CharacterProfileEntity>[];
			expected: Partial<ProfileDraft>;
		}[] = [
			{
				name: 'a later source scene supplies the content fields',
				destination: {
					sceneNumber: 1,
					updatedAt: 900,
					logline: 'destination logline',
					state: 'destination state',
					goal: 'destination goal',
					relationships: 'destination relationships',
					voice: 'destination voice',
					traits: ['destination trait'],
				},
				sources: [
					{
						sceneNumber: 3,
						updatedAt: 100,
						logline: 'source logline',
						state: 'source state',
						goal: 'source goal',
						relationships: 'source relationships',
						voice: 'source voice',
						traits: ['source trait'],
					},
				],
				expected: {
					logline: 'source logline',
					state: 'source state',
					goal: 'source goal',
					relationships: 'source relationships',
					voice: 'source voice',
					traits: ['source trait'],
				},
			},
			{
				name: 'the destination wins an equal-scene tie even with an older update clock',
				destination: { sceneNumber: 2, updatedAt: 100, logline: 'destination logline' },
				sources: [{ sceneNumber: 2, updatedAt: 900, logline: 'source logline' }],
				expected: { logline: 'destination logline' },
			},
			{
				name: 'the later update clock wins between tied same-scene sources',
				destination: { sceneNumber: 1, updatedAt: 999, logline: 'destination logline' },
				sources: [
					{ sceneNumber: 2, updatedAt: 100, logline: 'older source logline' },
					{ sceneNumber: 2, updatedAt: 500, logline: 'newer source logline' },
				],
				expected: { logline: 'newer source logline' },
			},
			{
				name: 'canonical name ascending resolves a complete tie deterministically',
				destination: { sceneNumber: 1, updatedAt: 999, logline: 'destination logline' },
				sources: [
					{ sceneNumber: 2, updatedAt: 500, canonicalName: 'zeta', logline: 'zeta logline' },
					{ sceneNumber: 2, updatedAt: 500, canonicalName: 'alpha', logline: 'alpha logline' },
				],
				expected: { logline: 'alpha logline' },
			},
			{
				name: 'a baseline destination loses to a numbered source scene',
				destination: { sceneNumber: null, updatedAt: 999, logline: 'baseline' },
				sources: [{ sceneNumber: 1, updatedAt: 1, logline: 'scene one' }],
				expected: { logline: 'scene one' },
			},
			{
				name: 'empty winner values are kept instead of falling back to older values',
				destination: {
					sceneNumber: 1,
					updatedAt: 900,
					logline: 'old logline',
					state: 'old state',
					goal: 'old goal',
					relationships: 'old relationships',
					voice: 'old voice',
					traits: ['old trait'],
				},
				sources: [
					{
						sceneNumber: 3,
						updatedAt: 100,
						logline: '',
						state: null,
						goal: '',
						relationships: null,
						voice: '',
						traits: [],
					},
				],
				expected: { logline: '', state: null, goal: '', relationships: null, voice: '', traits: [] },
			},
		];

		describe.each(rankCases)('$name', ({ destination, sources, expected }) => {
			it('selects fields from the top-ranked profile', () => {
				const draft = mergeProfileContent(
					entity({ id: 'dest', preferredName: 'Elena', canonicalName: 'elena', ...destination }),
					sources.map((source, index) =>
						entity({ id: `src-${index}`, preferredName: `Source ${index}`, canonicalName: `source-${index}`, ...source })
					)
				);
				expect(draft).toMatchObject(expected);
			});
		});

		it('unions aliases with source preferred names and dedupes exact matches', () => {
			const destination = entity({ id: 'dest', preferredName: 'Elena', canonicalName: 'elena', aliases: ['Elena', 'Lady'] });
			const sourceA = entity({ id: 'a', preferredName: 'Voss', canonicalName: 'voss', aliases: ['Voss', 'Captain', 'Elena'] });
			const sourceB = entity({ id: 'b', preferredName: 'Mira', canonicalName: 'mira', aliases: ['Mira', 'Captain'] });

			const draft = mergeProfileContent(destination, [sourceA, sourceB]);

			expect(draft.preferredName).toBe('Elena');
			expect(draft.aliases).toEqual(['Elena', 'Lady', 'Voss', 'Captain', 'Mira']);
		});

		it('keeps the destination identity even when a source outranks it', () => {
			const destination = entity({ id: 'dest', sceneNumber: 1, preferredName: 'Elena', canonicalName: 'elena' });
			const source = entity({ id: 'src', sceneNumber: 3, preferredName: 'Voss', canonicalName: 'voss', logline: 'Source logline' });

			const draft = mergeProfileContent(destination, [source]);

			expect(draft.preferredName).toBe('Elena');
			expect(draft.logline).toBe('Source logline');
		});

		it('uses the top-ranked profile as the scene-detail base and fills missing scenes in rank order', () => {
			const destination = entity({ id: 'dest', sceneNumber: 1, sceneDetails: '- 1: dest one\n- 5: dest five' });
			const source = entity({ id: 'src', sceneNumber: 3, sceneDetails: '- 3: source three\n- 5: source five' });

			const draft = mergeProfileContent(destination, [source]);

			expect(draft.sceneDetails).toBe('- 1: dest one\n- 3: source three\n- 5: source five');
		});

		it('resolves scene-detail conflicts among non-base profiles by rank order', () => {
			const destination = entity({ id: 'dest', sceneNumber: 4, sceneDetails: '- 4: dest four' });
			const sourceA = entity({ id: 'a', sceneNumber: 2, sceneDetails: '- 3: a three\n- 6: a six' });
			const sourceB = entity({ id: 'b', sceneNumber: 1, sceneDetails: '- 3: b three\n- 7: b seven' });

			const draft = mergeProfileContent(destination, [sourceA, sourceB]);

			expect(draft.sceneDetails).toBe('- 3: a three\n- 4: dest four\n- 6: a six\n- 7: b seven');
		});

		it('lets a baseline candidate fill a missing scene after numbered candidates', () => {
			const destination = entity({
				id: 'dest',
				sceneNumber: null,
				sceneDetails: '- 1: baseline one\n- 3: baseline three',
			});
			const source = entity({ id: 'src', sceneNumber: 3, sceneDetails: '- 3: source three\n- 4: source four' });

			const draft = mergeProfileContent(destination, [source]);

			expect(draft.sceneDetails).toBe('- 1: baseline one\n- 3: source three\n- 4: source four');
		});

		it('collapses multiline scene details to one line and sorts by ascending scene number', () => {
			// Why: consolidation re-serializes entries, and the storage contract is one line per scene.
			const destination = entity({ id: 'dest', sceneNumber: 1, sceneDetails: '' });
			const source = entity({ id: 'src', sceneNumber: 2, sceneDetails: '- 2: first line\nsecond line\n- 9: nine' });

			const draft = mergeProfileContent(destination, [source]);

			expect(draft.sceneDetails).toBe('- 2: first line second line\n- 9: nine');
		});
	});

	describe('consolidateProfiles', () => {
		it('consolidates one same-scene source in place using destination content priority', async () => {
			await seedScene(LINE, 2);
			const destination = entity({
				id: 'dest',
				sceneNumber: 2,
				preferredName: 'Elena',
				canonicalName: 'elena',
				aliases: ['Elena', 'Lady'],
				logline: 'Destination logline',
				state: 'Destination state',
				createdAt: 1000,
				updatedAt: 1000,
			});
			const source = entity({
				id: 'src',
				sceneNumber: 2,
				preferredName: 'Voss',
				canonicalName: 'voss',
				aliases: ['Voss', 'Captain'],
				logline: 'Source logline',
				state: 'Source state',
				traits: ['source trait'],
				createdAt: 1200,
				updatedAt: 1200,
			});
			await insertCharacterProfile(destination);
			await insertCharacterProfile(source);

			await consolidateProfiles(LINE, 2, destination, [source]);

			const destRow = await rawRow('dest');
			expect(destRow?.scene_number).toBe(2);
			expect(destRow?.created_at).toBe(1000);
			expect(destRow?.updated_at).toBeGreaterThan(1200);
			expect(destRow?.logline).toBe('Destination logline');
			expect(destRow?.state).toBe('Destination state');
			expect(destRow?.aliases).toBe(JSON.stringify(['Elena', 'Lady', 'Voss', 'Captain']));
			expect(destRow?.removed).toBe(0);

			const srcRow = await rawRow('src');
			expect(srcRow?.removed).toBe(1);
			expect(srcRow?.scene_number).toBe(2);
			expect(srcRow?.updated_at).toBeGreaterThan(1200);
			expect((await getProfilesAtScene(LINE, 2)).map((p) => p.id)).toEqual(['dest']);
			expect(await rawCount()).toBe(2);
		});

		it('consolidates several sources from mixed scenes, leaving earlier rows intact', async () => {
			await seedScene(LINE, 1);
			await seedScene(LINE, 2);
			await seedScene(LINE, 3);
			const destination = entity({
				id: 'dest',
				sceneNumber: 2,
				preferredName: 'Elena',
				canonicalName: 'elena',
				aliases: ['Elena'],
				logline: 'Destination logline',
				createdAt: 1000,
				updatedAt: 1000,
			});
			const sameSceneSource = entity({
				id: 'src-late',
				sceneNumber: 3,
				preferredName: 'Voss',
				canonicalName: 'voss',
				aliases: ['Voss', 'Captain'],
				logline: 'Source logline',
				state: 'Source state',
				traits: ['bold'],
				sceneDetails: '- 3: third',
				createdAt: 1500,
				updatedAt: 1500,
			});
			const earlierSource = entity({
				id: 'src-early',
				sceneNumber: 1,
				preferredName: 'Mira',
				canonicalName: 'mira',
				aliases: ['Mira', 'Captain'],
				logline: 'Earlier source logline',
				sceneDetails: '- 1: first\n- 3: earlier third',
				createdAt: 500,
				updatedAt: 500,
			});
			await insertCharacterProfile(destination);
			await insertCharacterProfile(sameSceneSource);
			await insertCharacterProfile(earlierSource);

			// The consolidation preview and the persisted destination must agree field for field.
			const preview = mergeProfileContent(destination, [sameSceneSource, earlierSource]);

			await consolidateProfiles(LINE, 3, destination, [sameSceneSource, earlierSource]);

			const written = (await getProfilesAtScene(LINE, 3))[0];
			expect(written.id).not.toBe('dest');
			expect(draftFrom(written)).toEqual(preview);
			expect(written.canonicalName).toBe('elena');
			expect(written.logline).toBe('Source logline');
			expect(written.state).toBe('Source state');
			expect(written.traits).toEqual(['bold']);
			expect(written.aliases).toEqual(['Elena', 'Voss', 'Captain', 'Mira']);
			expect(written.sceneDetails).toBe('- 1: first\n- 3: third');

			const destinationRow = await rawRow('dest');
			expect(destinationRow?.scene_number).toBe(2);
			expect(destinationRow?.logline).toBe('Destination logline');
			expect(destinationRow?.updated_at).toBe(1000);

			const lateSourceRow = await rawRow('src-late');
			expect(lateSourceRow?.removed).toBe(1);
			expect(lateSourceRow?.scene_number).toBe(3);

			const earlySourceRow = await rawRow('src-early');
			expect(earlySourceRow?.removed).toBe(0);
			expect(earlySourceRow?.scene_number).toBe(1);
			expect(earlySourceRow?.updated_at).toBe(500);

			const copiedTombstones = await testDb.select<Record<string, unknown>[]>(
				"SELECT * FROM character_profiles WHERE removed = 1 AND canonical_name = 'mira'"
			);
			expect(copiedTombstones).toHaveLength(1);
			expect(copiedTombstones[0].scene_number).toBe(3);
			expect(copiedTombstones[0].id).not.toBe('src-early');
			expect(await rawCount()).toBe(5);
		});

		it('applies no consolidation rows when one observed version is stale', async () => {
			await seedScene(LINE, 2);
			const destination = entity({
				id: 'dest',
				sceneNumber: 2,
				preferredName: 'Elena',
				canonicalName: 'elena',
				logline: 'Destination logline',
				createdAt: 1000,
				updatedAt: 1000,
			});
			const source = entity({
				id: 'src',
				sceneNumber: 2,
				preferredName: 'Voss',
				canonicalName: 'voss',
				createdAt: 1000,
				updatedAt: 1000,
			});
			await insertCharacterProfile(destination);
			await insertCharacterProfile(source);

			await expect(consolidateProfiles(LINE, 2, { ...destination, updatedAt: 999 }, [source])).rejects.toThrow(/no rows were changed/i);

			expect((await rawRow('dest'))?.logline).toBe('Destination logline');
			expect((await rawRow('dest'))?.updated_at).toBe(1000);
			expect((await rawRow('src'))?.removed).toBe(0);
		});

		it('applies no consolidation rows when the second source is stale and the destination is fresh', async () => {
			await seedScene(LINE, 2);
			const destination = entity({
				id: 'dest',
				sceneNumber: 2,
				preferredName: 'Elena',
				canonicalName: 'elena',
				logline: 'Destination logline',
				createdAt: 1000,
				updatedAt: 1000,
			});
			const firstSource = entity({
				id: 'src-first',
				sceneNumber: 2,
				preferredName: 'Voss',
				canonicalName: 'voss',
				logline: 'First source logline',
				createdAt: 1000,
				updatedAt: 1000,
			});
			const staleSource = entity({
				id: 'src-stale',
				sceneNumber: 2,
				preferredName: 'Mira',
				canonicalName: 'mira',
				logline: 'Stale source logline',
				createdAt: 1000,
				updatedAt: 1000,
			});
			await insertCharacterProfile(destination);
			await insertCharacterProfile(firstSource);
			await insertCharacterProfile(staleSource);

			// A split destination-first write would apply the fresh destination edit before the
			// stale source rejects; per-source writes would also apply the first source tombstone.
			// Only a single batch keeps every row untouched.
			await expect(consolidateProfiles(LINE, 2, destination, [firstSource, { ...staleSource, updatedAt: 999 }])).rejects.toThrow(
				/no rows were changed/i
			);

			expect((await rawRow('dest'))?.logline).toBe('Destination logline');
			expect((await rawRow('dest'))?.updated_at).toBe(1000);
			expect((await rawRow('src-first'))?.removed).toBe(0);
			expect((await rawRow('src-stale'))?.removed).toBe(0);
			expect(await rawCount()).toBe(3);
		});

		it('validates destination and source caller shape', async () => {
			await seedScene(LINE, 1);
			const destination = entity({
				id: 'dest',
				sceneNumber: 1,
				preferredName: 'Elena',
				canonicalName: 'elena',
			});
			const source = entity({ id: 'src', sceneNumber: 1, preferredName: 'Voss', canonicalName: 'voss' });

			await expect(consolidateProfiles(LINE, 1, destination, [])).rejects.toThrow(/at least one source/i);
			await expect(consolidateProfiles(LINE, 1, destination, [destination])).rejects.toThrow(/distinct|exclude the destination/i);
			await expect(consolidateProfiles(LINE, 1, destination, [source, source])).rejects.toThrow(/distinct|appears more than once/i);
			await expect(consolidateProfiles(LINE, 1, { ...destination, removed: true }, [source])).rejects.toThrow(/active/i);
			await expect(consolidateProfiles(LINE, 1, destination, [{ ...source, actLineId: 'other-line' }])).rejects.toThrow(/act line/i);
			await expect(consolidateProfiles(LINE, 1, destination, [{ ...source, sceneNumber: 2 }])).rejects.toThrow(
				/later than the selected scene/i
			);
			await expect(consolidateProfiles(LINE, 1, { ...destination, sceneNumber: 2 }, [source])).rejects.toThrow(
				/later than the selected scene/i
			);
			expect(await rawCount()).toBe(0);
		});
	});

	describe('caller-shape validation', () => {
		it('rejects malformed drafts, removal modes and identifiers before writing', async () => {
			await seedScene(LINE, 1);

			await expect(saveProfile(LINE, 1, null, addDraft({ preferredName: '   ' }))).rejects.toThrow(/preferred name.*not be empty/i);
			await expect(saveProfile(LINE, 1, null, addDraft({ importance: 5 as CharacterImportance }))).rejects.toThrow(/importance/i);
			await expect(saveProfile(LINE, 1, null, { ...addDraft(), aliases: 'Elena' as unknown as string[] })).rejects.toThrow(/aliases/i);
			await expect(saveProfile(LINE, 1, null, { ...addDraft(), sceneDetails: null as unknown as string })).rejects.toThrow(
				/scene details/i
			);
			await expect(removeProfile(LINE, 1, entity({ id: 'x' }), 'bogus' as 'entry')).rejects.toThrow(/mode/i);
			await expect(saveProfile('', 1, null, addDraft())).rejects.toThrow(/actLineId/i);
			await expect(saveProfile(LINE, 1.5, null, addDraft())).rejects.toThrow(/sceneNumber/i);

			expect(await rawCount()).toBe(0);
		});

		it('rejects an observed version from a later scene', async () => {
			await seedScene(LINE, 3);
			const later = entity({ id: 'later', sceneNumber: 3 });

			await expect(saveProfile(LINE, 2, later, draftFrom(later))).rejects.toThrow(/later than the selected scene/i);
		});
	});
});
