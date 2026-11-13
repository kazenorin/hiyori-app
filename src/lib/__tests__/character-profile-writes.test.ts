import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { createTestDatabase } from './helpers/test-database';
import type { Database } from '#lib/db/types.ts';
import { SqlJsDatabase } from '#lib/db/adapters/sqljs-database.ts';
import { runMigrations } from '#lib/db/migrations.ts';

let testDb: Database;

vi.mock('#lib/db/database.ts', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

import {
	writeProfileVersions,
	deleteProfileEntry,
	insertCharacterProfile,
	getProfilesAtScene,
	getLatestProfilesByActLine,
	type CharacterProfileEntity,
} from '#lib/db/character-profiles.ts';

const LINE = 'line-1';
const SQLJS_WASM_PATH = path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

/**
 * The guarded write primitive must rely on a single SQL statement because the
 * database interface has no transaction API; both adapters that can run in Node
 * are exercised so the statement is proven beyond the native adapter.
 */
const ADAPTERS: { name: string; create: () => Promise<Database> }[] = [
	{ name: 'better-sqlite3', create: async () => createTestDatabase() },
	{ name: 'sql.js', create: () => SqlJsDatabase.create(null, { locateWasm: () => SQLJS_WASM_PATH }) },
];

function entity(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
	const preferredName = overrides.preferredName ?? 'Elena';
	return {
		id: 'p1',
		actLineId: LINE,
		sceneNumber: 1,
		canonicalName: preferredName.toLowerCase(),
		preferredName,
		aliases: [preferredName],
		logline: 'Logline',
		state: null,
		goal: null,
		relationships: null,
		voice: null,
		traits: [],
		sceneDetails: '',
		importance: 2,
		removed: false,
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

async function seedScene(sceneNumber: number, actLineId = LINE): Promise<void> {
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

async function rawCount(): Promise<number> {
	const rows = await testDb.select<{ total: number }[]>('SELECT COUNT(*) AS total FROM character_profiles');
	return rows[0].total;
}

describe.each(ADAPTERS)('guarded character profile writes ($name)', ({ create }) => {
	beforeEach(async () => {
		testDb = await create();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('inserts a new active row at the latest scene and refuses a duplicate id', async () => {
		await seedScene(1);

		await writeProfileVersions(LINE, 1, [{ previous: null, next: entity({ id: 'fresh', updatedAt: 5000, createdAt: 5000 }) }]);

		const visible = await getProfilesAtScene(LINE, 1);
		expect(visible.map((p) => p.id)).toEqual(['fresh']);
		expect(visible[0].removed).toBe(false);

		await expect(writeProfileVersions(LINE, 1, [{ previous: null, next: entity({ id: 'fresh', updatedAt: 6000 }) }])).rejects.toThrow(
			/no rows were changed/i
		);
		expect((await rawRow('fresh'))?.updated_at).toBe(5000);
	});

	it('updates a same-scene version in place, preserving creation time and advancing the update clock', async () => {
		await seedScene(1);
		const original = entity({
			id: 'p1',
			aliases: ['Elena', 'Shadow'],
			traits: ['bold'],
			createdAt: 1000,
			updatedAt: 1000,
		});
		await writeProfileVersions(LINE, 1, [{ previous: null, next: original }]);

		// A caller-supplied createdAt that diverges from the stored row proves the
		// update preserves creation time instead of trusting the next version.
		const edited = entity({
			...original,
			logline: 'Edited logline',
			state: 'wounded',
			aliases: ['Elena', 'Shadow', 'Mira'],
			traits: ['bold', 'cunning'],
			removed: true,
			createdAt: 9999,
			updatedAt: 2000,
		});
		await writeProfileVersions(LINE, 1, [{ previous: original, next: edited }]);

		const row = await rawRow('p1');
		expect(row?.logline).toBe('Edited logline');
		expect(row?.state).toBe('wounded');
		expect(row?.created_at).toBe(1000);
		expect(row?.updated_at).toBe(2000);
		expect(row?.aliases).toBe(JSON.stringify(['Elena', 'Shadow', 'Mira']));
		expect(row?.traits).toBe('bold, cunning');
		expect(row?.removed).toBe(1);
		expect(await rawCount()).toBe(1);
	});

	it('copies an earlier-scene version into the selected scene without touching the source row', async () => {
		await seedScene(1);
		const earlier = entity({ id: 'v1', logline: 'Scene 1 Elena', createdAt: 1000, updatedAt: 1000 });
		await writeProfileVersions(LINE, 1, [{ previous: null, next: earlier }]);
		await seedScene(2);

		const copied = entity({
			...earlier,
			id: 'v2',
			sceneNumber: 2,
			logline: 'Scene 2 Elena',
			createdAt: 2000,
			updatedAt: 2000,
		});
		await writeProfileVersions(LINE, 2, [{ previous: earlier, next: copied }]);

		const source = await rawRow('v1');
		expect(source?.scene_number).toBe(1);
		expect(source?.logline).toBe('Scene 1 Elena');
		expect(source?.updated_at).toBe(1000);
		expect((await rawRow('v2'))?.scene_number).toBe(2);
		expect((await getProfilesAtScene(LINE, 2)).map((p) => p.id)).toEqual(['v2']);
		expect((await getProfilesAtScene(LINE, 1)).map((p) => p.id)).toEqual(['v1']);
	});

	it('copies a baseline version into the selected scene with a fresh id', async () => {
		await seedScene(1);
		const baseline = entity({ id: 'base', sceneNumber: null, logline: 'Baseline Elena', createdAt: 500, updatedAt: 500 });
		await insertCharacterProfile(baseline);

		await writeProfileVersions(LINE, 1, [
			{ previous: baseline, next: { ...baseline, id: 'scene-1', sceneNumber: 1, logline: 'Promoted Elena', updatedAt: 1500 } },
		]);

		expect((await rawRow('base'))?.scene_number).toBeNull();
		expect((await rawRow('base'))?.logline).toBe('Baseline Elena');
		expect((await getProfilesAtScene(LINE, 1)).map((p) => p.id)).toEqual(['scene-1']);
	});

	it('regenerates canonical_aliases from the aliases being written on insert, update and copy', async () => {
		await seedScene(1);
		const original = entity({ id: 'p1', aliases: ['Elena Vale', 'Lady Vale'], createdAt: 1000, updatedAt: 1000 });
		await writeProfileVersions(LINE, 1, [{ previous: null, next: original }]);
		expect((await rawRow('p1'))?.canonical_aliases).toBe(JSON.stringify(['elena-vale', 'lady-vale']));

		const edited = { ...original, aliases: ['Mira'], updatedAt: 2000 };
		await writeProfileVersions(LINE, 1, [{ previous: original, next: edited }]);
		expect((await rawRow('p1'))?.canonical_aliases).toBe(JSON.stringify(['mira']));

		await seedScene(2);
		const copied = entity({ id: 'p2', sceneNumber: 2, aliases: ['Elena', 'The Captain'], createdAt: 3000, updatedAt: 3000 });
		await writeProfileVersions(LINE, 2, [{ previous: edited, next: copied }]);
		expect((await rawRow('p2'))?.canonical_aliases).toBe(JSON.stringify(['elena', 'the-captain']));
	});

	it('rejects mutations at a historical scene without changing any row', async () => {
		await seedScene(1);
		const historical = entity({ id: 'p1', logline: 'Scene 1', createdAt: 1000, updatedAt: 1000 });
		await writeProfileVersions(LINE, 1, [{ previous: null, next: historical }]);
		await seedScene(2);
		await seedScene(3);

		await expect(
			writeProfileVersions(LINE, 1, [{ previous: historical, next: { ...historical, logline: 'Rewritten', updatedAt: 2000 } }])
		).rejects.toThrow(/no rows were changed/i);
		await expect(writeProfileVersions(LINE, 1, [{ previous: null, next: entity({ id: 'p2', updatedAt: 3000 }) }])).rejects.toThrow(
			/no rows were changed/i
		);

		expect((await rawRow('p1'))?.logline).toBe('Scene 1');
		expect((await rawRow('p1'))?.updated_at).toBe(1000);
		expect(await rawRow('p2')).toBeNull();
	});

	it('rejects a stale observed version so concurrent edits cannot silently overwrite each other', async () => {
		await seedScene(1);
		const v1 = entity({ id: 'p1', logline: 'First', createdAt: 1000, updatedAt: 1000 });
		await writeProfileVersions(LINE, 1, [{ previous: null, next: v1 }]);
		const v2 = { ...v1, logline: 'Second', updatedAt: 2000 };
		await writeProfileVersions(LINE, 1, [{ previous: v1, next: v2 }]);

		await expect(
			writeProfileVersions(LINE, 1, [{ previous: v1, next: { ...v1, logline: 'Stale overwrite', updatedAt: 3000 } }])
		).rejects.toThrow(/no rows were changed/i);

		expect((await rawRow('p1'))?.logline).toBe('Second');
		expect((await rawRow('p1'))?.updated_at).toBe(2000);
	});

	it('physically deletes a same-scene version, revealing the older snapshot, and refuses older-scene deletions', async () => {
		await seedScene(1);
		const v1 = entity({ id: 'v1', logline: 'Version 1', createdAt: 1000, updatedAt: 1000 });
		await writeProfileVersions(LINE, 1, [{ previous: null, next: v1 }]);
		await seedScene(2);
		const v2 = entity({ id: 'v2', sceneNumber: 2, logline: 'Version 2', createdAt: 2000, updatedAt: 2000 });
		await writeProfileVersions(LINE, 2, [{ previous: null, next: v2 }]);

		expect((await getProfilesAtScene(LINE, 2)).map((p) => p.id)).toEqual(['v2']);
		await deleteProfileEntry(LINE, 2, v2);

		expect(await rawRow('v2')).toBeNull();
		expect((await getProfilesAtScene(LINE, 2)).map((p) => p.id)).toEqual(['v1']);
		expect((await getLatestProfilesByActLine(LINE)).map((p) => p.id)).toEqual(['v1']);

		// Leaving a scene-2 row with a matching clock in place means the latest-scene
		// guard inside the DELETE statement is the only thing that can reject this.
		const survivor = entity({
			id: 'v2-survivor',
			sceneNumber: 2,
			preferredName: 'Voss',
			logline: 'Survivor',
			createdAt: 2000,
			updatedAt: 2000,
		});
		await writeProfileVersions(LINE, 2, [{ previous: null, next: survivor }]);

		await seedScene(3);
		await expect(deleteProfileEntry(LINE, 2, survivor)).rejects.toThrow(/no rows were deleted/i);
		expect(await rawRow('v2-survivor')).not.toBeNull();

		await expect(deleteProfileEntry(LINE, 3, v1)).rejects.toThrow(/no rows were deleted/i);
		expect(await rawRow('v1')).not.toBeNull();

		const v3 = entity({ id: 'v3', sceneNumber: 3, logline: 'Version 3', createdAt: 3000, updatedAt: 3000 });
		await writeProfileVersions(LINE, 3, [{ previous: null, next: v3 }]);
		await expect(deleteProfileEntry(LINE, 3, { ...v3, updatedAt: 2999 })).rejects.toThrow(/no rows were deleted/i);
		expect(await rawRow('v3')).not.toBeNull();
	});

	it('applies a destination edit and two source tombstones as one atomic batch', async () => {
		await seedScene(1);
		await seedScene(2);
		const dest = entity({ id: 'dest', sceneNumber: 2, logline: 'Destination base', aliases: ['Elena'], createdAt: 1000, updatedAt: 1000 });
		const src1 = entity({
			id: 'src1',
			sceneNumber: 2,
			preferredName: 'Voss',
			logline: 'Voss source',
			aliases: ['Voss'],
			createdAt: 1000,
			updatedAt: 1000,
		});
		const src2 = entity({
			id: 'src2',
			sceneNumber: 2,
			preferredName: 'Mira',
			logline: 'Mira source',
			aliases: ['Mira'],
			createdAt: 1000,
			updatedAt: 1000,
		});
		await writeProfileVersions(LINE, 2, [
			{ previous: null, next: dest },
			{ previous: null, next: src1 },
			{ previous: null, next: src2 },
		]);

		// Advance src2 so the batch below observes a stale version for that source only.
		const src2Advanced = { ...src2, updatedAt: 1500 };
		await writeProfileVersions(LINE, 2, [{ previous: src2, next: src2Advanced }]);

		const destNext = { ...dest, logline: 'Destination merged', aliases: ['Elena', 'Voss', 'Mira'], updatedAt: 2000 };
		const src1Next = { ...src1, removed: true, updatedAt: 2000 };
		const staleSrc2Next = { ...src2, removed: true, updatedAt: 2000 };

		await expect(
			writeProfileVersions(LINE, 2, [
				{ previous: dest, next: destNext },
				{ previous: src1, next: src1Next },
				{ previous: src2, next: staleSrc2Next },
			])
		).rejects.toThrow(/no rows were changed/i);

		// None of the batch may apply, including rows before the stale one.
		const destAfterFailure = await rawRow('dest');
		expect(destAfterFailure?.logline).toBe('Destination base');
		expect(destAfterFailure?.updated_at).toBe(1000);
		expect(destAfterFailure?.aliases).toBe(JSON.stringify(['Elena']));
		const src1AfterFailure = await rawRow('src1');
		expect(src1AfterFailure?.removed).toBe(0);
		expect(src1AfterFailure?.updated_at).toBe(1000);
		expect(src1AfterFailure?.logline).toBe('Voss source');
		const src2AfterFailure = await rawRow('src2');
		expect(src2AfterFailure?.removed).toBe(0);
		expect(src2AfterFailure?.updated_at).toBe(1500);

		await writeProfileVersions(LINE, 2, [
			{ previous: dest, next: destNext },
			{ previous: src1, next: src1Next },
			{ previous: src2Advanced, next: { ...src2Advanced, removed: true, updatedAt: 2000 } },
		]);

		expect((await rawRow('dest'))?.logline).toBe('Destination merged');
		expect((await rawRow('dest'))?.aliases).toBe(JSON.stringify(['Elena', 'Voss', 'Mira']));
		expect((await rawRow('dest'))?.updated_at).toBe(2000);
		expect((await rawRow('src1'))?.removed).toBe(1);
		expect((await rawRow('src2'))?.removed).toBe(1);
		expect((await getProfilesAtScene(LINE, 2)).map((p) => p.id)).toEqual(['dest']);
	});

	it('lets same-scene duplicate versions keep existing winner precedence instead of a unique constraint', async () => {
		await seedScene(1);
		const olderTwin = entity({ id: 'older', logline: 'Older twin', createdAt: 1000, updatedAt: 1000 });
		const newerTwin = entity({ id: 'newer', logline: 'Newer twin', createdAt: 2000, updatedAt: 2000 });
		await writeProfileVersions(LINE, 1, [
			{ previous: null, next: olderTwin },
			{ previous: null, next: newerTwin },
		]);

		expect((await getProfilesAtScene(LINE, 1)).map((p) => p.id)).toEqual(['newer']);

		// Updating the non-winning twin in place must not disturb creation-time precedence.
		await writeProfileVersions(LINE, 1, [{ previous: olderTwin, next: { ...olderTwin, logline: 'Older twin edited', updatedAt: 3000 } }]);

		expect(await rawCount()).toBe(2);
		expect((await rawRow('older'))?.logline).toBe('Older twin edited');
		expect((await getProfilesAtScene(LINE, 1)).map((p) => p.id)).toEqual(['newer']);
	});

	it('rejects an empty write batch explicitly', async () => {
		await seedScene(1);

		await expect(writeProfileVersions(LINE, 1, [])).rejects.toThrow(/no profile versions/i);
		expect(await rawCount()).toBe(0);
	});

	it('rejects invalid caller shape before issuing SQL', async () => {
		await seedScene(1);
		const sameScene = entity({ id: 'p1' });

		await expect(
			writeProfileVersions(LINE, 1, [{ previous: sameScene, next: { ...sameScene, id: 'p2', updatedAt: 2000 } }])
		).rejects.toThrow(/same-scene/i);
		await expect(
			writeProfileVersions(LINE, 1, [{ previous: { ...sameScene, sceneNumber: null }, next: { ...sameScene, updatedAt: 2000 } }])
		).rejects.toThrow(/fresh id/i);
		await expect(writeProfileVersions(LINE, 1, [{ previous: null, next: entity({ id: 'p3', sceneNumber: 2 }) }])).rejects.toThrow(
			/scene 1/i
		);
		await expect(writeProfileVersions(LINE, 1, [{ previous: null, next: entity({ id: 'p4', actLineId: 'other-line' }) }])).rejects.toThrow(
			/act line/i
		);
		expect(await rawCount()).toBe(0);
	});
});
