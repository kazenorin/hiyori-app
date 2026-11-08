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
	getLatestProfilesByActLine,
	getLatestProfileByAlias,
	getLatestProfileByAliasIncludingRemoved,
	areAnyCharacterNamesKnown,
	getCharacterProfilesForActLines,
	deleteCharacterProfilesForScenes,
	cloneCharacterProfiles,
	inheritProfilesFromActLine,
	resolveTombstonedCanonicalName,
	toCanonicalName,
	type InsertCharacterProfileInput,
} from '#lib/db/character-profiles.ts';

const LINE = 'line-1';
let counter = 0;

function makeProfile(overrides: Partial<InsertCharacterProfileInput> = {}): InsertCharacterProfileInput {
	counter += 1;
	const preferredName = overrides.preferredName ?? 'Elena';
	return {
		id: `p${counter}`,
		actLineId: LINE,
		sceneNumber: 1,
		canonicalName: toCanonicalName(preferredName),
		preferredName,
		aliases: [preferredName],
		logline: `Logline ${counter}`,
		sceneDetails: '',
		importance: 2,
		createdAt: 1000 + counter,
		...overrides,
	};
}

describe('character profile history', () => {
	beforeEach(async () => {
		counter = 0;
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('settles a baseline row before numbered scenes', async () => {
		await insertCharacterProfile(makeProfile({ sceneNumber: null, logline: 'Baseline Elena' }));
		await insertCharacterProfile(makeProfile({ sceneNumber: 2, logline: 'Scene 2 Elena' }));

		const atScene1 = await getProfilesAtScene(LINE, 1);
		expect(atScene1.map((p) => p.logline)).toEqual(['Baseline Elena']);

		const atScene2 = await getProfilesAtScene(LINE, 2);
		expect(atScene2.map((p) => p.logline)).toEqual(['Scene 2 Elena']);

		const latest = await getLatestProfilesByActLine(LINE);
		expect(latest.map((p) => p.logline)).toEqual(['Scene 2 Elena']);
	});

	it('hides profiles from future scenes', async () => {
		await insertCharacterProfile(makeProfile({ sceneNumber: 1, logline: 'Scene 1 Elena' }));
		await insertCharacterProfile(makeProfile({ sceneNumber: 5, logline: 'Scene 5 Elena' }));

		const atScene2 = await getProfilesAtScene(LINE, 2);
		expect(atScene2.map((p) => p.logline)).toEqual(['Scene 1 Elena']);
	});

	it('ranks all versions before excluding a tombstone winner', async () => {
		await insertCharacterProfile(makeProfile({ sceneNumber: 1, logline: 'Alive at scene 1' }));
		await insertCharacterProfile(makeProfile({ sceneNumber: 2, logline: 'Erased at scene 2', removed: true }));

		expect(await getProfilesAtScene(LINE, 2)).toEqual([]);
		expect(await getLatestProfilesByActLine(LINE)).toEqual([]);

		const atScene1 = await getProfilesAtScene(LINE, 1);
		expect(atScene1.map((p) => p.logline)).toEqual(['Alive at scene 1']);

		const history = await getCharacterProfilesForActLines([LINE]);
		expect(history).toHaveLength(2);
		expect(history.filter((p) => p.removed)).toHaveLength(1);
	});

	it('keeps importance-first presentation ordering at the selected scene', async () => {
		await insertCharacterProfile(makeProfile({ sceneNumber: 1, preferredName: 'Voss', importance: 4 }));
		await insertCharacterProfile(makeProfile({ sceneNumber: 2, preferredName: 'Elena', importance: 1 }));
		await insertCharacterProfile(makeProfile({ sceneNumber: 1, preferredName: 'Mira', importance: 2 }));

		const atScene2 = await getProfilesAtScene(LINE, 2);
		expect(atScene2.map((p) => p.preferredName)).toEqual(['Elena', 'Mira', 'Voss']);
	});

	it('re-exposes the earlier snapshot after a rewind', async () => {
		await insertCharacterProfile(makeProfile({ sceneNumber: 1, logline: 'Version 1' }));
		await insertCharacterProfile(makeProfile({ sceneNumber: 2, logline: 'Version 2' }));

		expect((await getProfilesAtScene(LINE, 2)).map((p) => p.logline)).toEqual(['Version 2']);

		await deleteCharacterProfilesForScenes(LINE, [2]);

		expect((await getProfilesAtScene(LINE, 2)).map((p) => p.logline)).toEqual(['Version 1']);
		expect((await getLatestProfilesByActLine(LINE)).map((p) => p.logline)).toEqual(['Version 1']);
	});

	it('ignores an alias that exists only on an obsolete version', async () => {
		await insertCharacterProfile(makeProfile({ sceneNumber: 1, aliases: ['Elena', 'Shadow'], logline: 'Old alias holder' }));
		await insertCharacterProfile(makeProfile({ sceneNumber: 2, aliases: ['Elena'], logline: 'Current Elena' }));

		expect(await getLatestProfileByAlias(LINE, 'Shadow')).toBeNull();
		expect(await areAnyCharacterNamesKnown(LINE, ['Shadow'])).toBe(false);
		expect(await areAnyCharacterNamesKnown(LINE, ['Elena'])).toBe(true);
	});

	it('ranks the active version before excluding a tombstoned alias match', async () => {
		await insertCharacterProfile(
			makeProfile({
				sceneNumber: 1,
				preferredName: 'Voss',
				aliases: ['Voss', 'Captain'],
				logline: 'Alive captain',
			})
		);
		await insertCharacterProfile(
			makeProfile({
				sceneNumber: 2,
				preferredName: 'Voss',
				aliases: ['Voss', 'Captain'],
				logline: 'Erased captain',
				removed: true,
			})
		);

		expect(await getLatestProfileByAlias(LINE, 'Captain')).toBeNull();
		expect(await areAnyCharacterNamesKnown(LINE, ['Captain', 'Voss'])).toBe(false);
		expect((await getProfilesAtScene(LINE, 1)).map((p) => p.logline)).toEqual(['Alive captain']);
	});

	it('exposes the tombstone winner when callers must not resurrect an erased identity', async () => {
		await insertCharacterProfile(
			makeProfile({ sceneNumber: 2, preferredName: 'Voss', aliases: ['Voss', 'Captain'], logline: 'Erased captain', removed: true })
		);
		await insertCharacterProfile(makeProfile({ sceneNumber: 3, preferredName: 'Elena', logline: 'Living Elena' }));

		const erased = await getLatestProfileByAliasIncludingRemoved(LINE, 'Captain');
		expect(erased?.removed).toBe(true);
		expect(erased?.canonicalName).toBe('voss');
		expect(await getLatestProfileByAlias(LINE, 'Captain')).toBeNull();
		expect((await getLatestProfileByAliasIncludingRemoved(LINE, 'Elena'))?.removed).toBe(false);
		expect(await getLatestProfileByAliasIncludingRemoved(LINE, 'Unknown')).toBeNull();
	});

	it('resolves a consolidated source alias to the active destination', async () => {
		await insertCharacterProfile(
			makeProfile({
				sceneNumber: 2,
				canonicalName: 'elena',
				preferredName: 'Elena',
				aliases: ['Elena', 'Shadow'],
				logline: 'Elena prime',
			})
		);
		await insertCharacterProfile(
			makeProfile({
				sceneNumber: 2,
				canonicalName: 'shadow',
				preferredName: 'Shadow',
				aliases: ['Shadow'],
				logline: 'Erased source',
				removed: true,
			})
		);

		const match = await getLatestProfileByAlias(LINE, 'Shadow');
		expect(match?.canonicalName).toBe('elena');
		expect(await areAnyCharacterNamesKnown(LINE, ['Shadow'])).toBe(true);
		expect(await resolveTombstonedCanonicalName(LINE, ['Shadow'])).toBeNull();
	});

	it('reuses the latest tombstoned canonical identity when no active identity matches', async () => {
		await insertCharacterProfile(
			makeProfile({
				sceneNumber: 1,
				canonicalName: 'elena-shadowcrest',
				preferredName: 'Elena Shadowcrest',
				aliases: ['Elena Shadowcrest', 'Shadow'],
				logline: 'Original identity',
			})
		);
		await insertCharacterProfile(
			makeProfile({
				sceneNumber: 2,
				canonicalName: 'elena-shadowcrest',
				preferredName: 'Elena Shadowcrest',
				aliases: ['Elena Shadowcrest', 'Shadow'],
				logline: 'Erased identity',
				removed: true,
			})
		);

		expect(await resolveTombstonedCanonicalName(LINE, ['Shadow'])).toBe('elena-shadowcrest');
		expect(await resolveTombstonedCanonicalName(LINE, ['Unknown'])).toBeNull();

		const revived = makeProfile({
			sceneNumber: 3,
			canonicalName: 'elena-shadowcrest',
			preferredName: 'Elena Shadowcrest',
			aliases: ['Elena Shadowcrest', 'Shadow'],
			logline: 'Revived at scene 3',
		});
		await insertCharacterProfile(revived);

		const latest = await getLatestProfilesByActLine(LINE);
		expect(latest.map((p) => p.logline)).toEqual(['Revived at scene 3']);
		expect(latest[0].id).toBe(revived.id);
		expect(latest[0].removed).toBe(false);
		expect(await getProfilesAtScene(LINE, 2)).toEqual([]);
	});

	it('clones full history including tombstones and preserves precedence', async () => {
		await insertCharacterProfile(makeProfile({ sceneNumber: 1, logline: 'Fork v1', createdAt: 1000 }));
		await insertCharacterProfile(makeProfile({ sceneNumber: 2, logline: 'Fork tombstone', createdAt: 2000, removed: true }));

		await cloneCharacterProfiles(LINE, 'fork-line', 2);

		const cloned = (await getCharacterProfilesForActLines(['fork-line'])).sort((a, b) => (a.sceneNumber ?? -1) - (b.sceneNumber ?? -1));
		expect(cloned).toHaveLength(2);
		expect(cloned.map((p) => p.removed)).toEqual([false, true]);
		expect(cloned.map((p) => p.createdAt)).toEqual([1000, 2000]);
		expect(await getLatestProfilesByActLine('fork-line')).toEqual([]);
		expect((await getProfilesAtScene('fork-line', 1)).map((p) => p.logline)).toEqual(['Fork v1']);
	});

	it('inherits only active winners as baseline rows', async () => {
		await insertCharacterProfile(makeProfile({ sceneNumber: 1, preferredName: 'Elena', logline: 'Active Elena' }));
		await insertCharacterProfile(makeProfile({ sceneNumber: 1, preferredName: 'Voss', logline: 'Active Voss' }));
		await insertCharacterProfile(makeProfile({ sceneNumber: 2, preferredName: 'Voss', logline: 'Erased Voss', removed: true }));

		await inheritProfilesFromActLine(LINE, 'next-act');

		const inherited = await getCharacterProfilesForActLines(['next-act']);
		expect(inherited.map((p) => p.canonicalName)).toEqual(['elena']);
		expect(inherited[0].sceneNumber).toBeNull();
		expect(inherited[0].removed).toBe(false);
	});
});
