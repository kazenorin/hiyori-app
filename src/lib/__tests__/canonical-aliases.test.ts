import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from './helpers/test-database';
import { runMigrations, backfillCanonicalAliases } from '#lib/db/migrations.ts';

let testDb: ReturnType<typeof createTestDatabase>;

vi.mock('#lib/db/database.ts', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

import {
	insertCharacterProfile,
	getLatestProfileByAlias,
	areAnyCharacterNamesKnown,
	resolveTombstonedCanonicalName,
	cloneCharacterProfiles,
	inheritProfilesFromActLine,
	type InsertCharacterProfileInput,
} from '#lib/db/character-profiles.ts';

const LINE = 'line-1';

function makeProfile(overrides: Partial<InsertCharacterProfileInput> = {}): InsertCharacterProfileInput {
	return {
		id: 'p1',
		actLineId: LINE,
		sceneNumber: 1,
		canonicalName: 'elena-vale',
		preferredName: 'Elena Vale',
		aliases: ['Elena Vale', 'Lady Vale'],
		logline: 'A determined hero.',
		sceneDetails: '',
		importance: 2,
		createdAt: 1000,
		...overrides,
	};
}

async function rawCanonicalAliases(id: string): Promise<unknown> {
	const rows = await testDb.select<{ canonical_aliases: string }[]>('SELECT canonical_aliases FROM character_profiles WHERE id = $1', [id]);
	return rows[0]?.canonical_aliases;
}

describe('canonical_aliases migration (v16)', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('adds the column and backfills canonical forms when upgrading a v15 database', async () => {
		// Simulate a pre-v16 database: undo every migration after 15 (the runner
		// resumes from MAX(version), so all later version rows must go too), and
		// seed rows in the old shape so migration 16 runs again.
		await testDb.execute('ALTER TABLE character_profiles DROP COLUMN canonical_aliases');
		await testDb.execute('ALTER TABLE message_phases DROP COLUMN processed_content');
		await testDb.execute('DELETE FROM schema_version WHERE version >= 16');
		await testDb.execute(
			`INSERT INTO character_profiles (id, act_line_id, canonical_name, preferred_name, aliases, logline, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			['legacy-1', LINE, 'elena-vale', 'Elena Vale', JSON.stringify(['Elena Vale', 'Lady Vale']), 'hero', 1000, 1000]
		);

		await runMigrations();

		expect(await rawCanonicalAliases('legacy-1')).toBe(JSON.stringify(['elena-vale', 'lady-vale']));
	});

	it('backfill dedupes canonical forms and tolerates invalid or empty aliases', async () => {
		await testDb.execute(
			`INSERT INTO character_profiles (id, act_line_id, canonical_name, preferred_name, aliases, logline, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			['dup-1', LINE, 'elena-vale', 'Elena Vale', JSON.stringify(['Elena Vale', 'elena-vale', '[Lady Vale]']), 'hero', 1000, 1000]
		);
		await testDb.execute(
			`INSERT INTO character_profiles (id, act_line_id, canonical_name, preferred_name, aliases, logline, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			['bad-1', LINE, 'voss', 'Voss', 'not json', 'captain', 1000, 1000]
		);

		await backfillCanonicalAliases();

		expect(await rawCanonicalAliases('dup-1')).toBe(JSON.stringify(['elena-vale', 'lady-vale']));
		expect(await rawCanonicalAliases('bad-1')).toBe('[]');
	});
});

describe('canonical_aliases regeneration on write', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('insertCharacterProfile stores canonical forms of the aliases being written', async () => {
		await insertCharacterProfile(makeProfile());

		expect(await rawCanonicalAliases('p1')).toBe(JSON.stringify(['elena-vale', 'lady-vale']));
	});

	it('cloneCharacterProfiles regenerates from the copied aliases, not the stored column', async () => {
		await insertCharacterProfile(makeProfile());
		await testDb.execute('UPDATE character_profiles SET canonical_aliases = $1 WHERE id = $2', ['["stale"]', 'p1']);

		await cloneCharacterProfiles(LINE, 'dest', 5);

		const rows = await testDb.select<{ canonical_aliases: string }[]>(
			'SELECT canonical_aliases FROM character_profiles WHERE act_line_id = $1',
			['dest']
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].canonical_aliases).toBe(JSON.stringify(['elena-vale', 'lady-vale']));
	});

	it('inheritProfilesFromActLine regenerates from the folded alias set', async () => {
		await insertCharacterProfile(makeProfile({ aliases: ['Lady Vale'] }));
		await testDb.execute('UPDATE character_profiles SET canonical_aliases = $1 WHERE id = $2', ['["stale"]', 'p1']);

		await inheritProfilesFromActLine(LINE, 'dest');

		const rows = await testDb.select<{ aliases: string; canonical_aliases: string }[]>(
			'SELECT aliases, canonical_aliases FROM character_profiles WHERE act_line_id = $1',
			['dest']
		);
		expect(rows).toHaveLength(1);
		expect(JSON.parse(rows[0].aliases)).toEqual(['Elena Vale', 'Lady Vale']);
		expect(rows[0].canonical_aliases).toBe(JSON.stringify(['elena-vale', 'lady-vale']));
	});
});

describe('canonical-form identity matching', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('getLatestProfileByAlias resolves case, punctuation and bracket variants to the same identity', async () => {
		await insertCharacterProfile(makeProfile());

		// kebabCase splits mixed-case runs ('ELena' → 'e-lena'), so only
		// structurally equivalent variants normalize to the same form.
		for (const variant of ['ELENA VALE!', '[Elena Vale]', 'elena-vale', 'lady vale', 'Elena Vale', 'Lady Vale']) {
			const match = await getLatestProfileByAlias(LINE, variant);
			expect(match?.id, variant).toBe('p1');
		}
	});

	it('getLatestProfileByAlias returns null for unrelated names', async () => {
		await insertCharacterProfile(makeProfile());

		expect(await getLatestProfileByAlias(LINE, 'Voss')).toBeNull();
	});

	it('a tombstoned identity never matches, even through its earlier aliases', async () => {
		// Revival semantics: the erased winner must not reveal the earlier version,
		// and obsolete aliases of the superseded version must not match either.
		await insertCharacterProfile(makeProfile());
		await insertCharacterProfile(makeProfile({ id: 'p2', sceneNumber: 2, aliases: ['Elena Vale'], removed: true, createdAt: 2000 }));

		expect(await getLatestProfileByAlias(LINE, 'Elena Vale')).toBeNull();
		expect(await getLatestProfileByAlias(LINE, '[Lady Vale]')).toBeNull();
		expect(await areAnyCharacterNamesKnown(LINE, ['Elena Vale'])).toBe(false);
	});

	it('areAnyCharacterNamesKnown matches canonical variants and rejects unrelated or erased names', async () => {
		await insertCharacterProfile(makeProfile());

		expect(await areAnyCharacterNamesKnown(LINE, ['[Lady Vale]'])).toBe(true);
		expect(await areAnyCharacterNamesKnown(LINE, ['ELENA VALE!', 'Voss'])).toBe(true);
		expect(await areAnyCharacterNamesKnown(LINE, ['Voss'])).toBe(false);
	});

	it('resolveTombstonedCanonicalName resolves canonical variants of an erased identity', async () => {
		await insertCharacterProfile(makeProfile({ id: 'p2', sceneNumber: 2, aliases: ['Elena Vale'], removed: true, createdAt: 2000 }));

		expect(await resolveTombstonedCanonicalName(LINE, ['[Elena Vale]'])).toBe('elena-vale');
		// 'Lady Vale' belongs only to the superseded version, not the erased winner.
		expect(await resolveTombstonedCanonicalName(LINE, ['lady vale'])).toBeNull();
		expect(await resolveTombstonedCanonicalName(LINE, ['Voss'])).toBeNull();
	});

	it('resolveTombstonedCanonicalName refuses when an active identity owns any of the names', async () => {
		await insertCharacterProfile(makeProfile({ id: 'p2', sceneNumber: 2, aliases: ['Elena Vale'], removed: true, createdAt: 2000 }));
		await insertCharacterProfile(makeProfile({ id: 'p3', canonicalName: 'voss', preferredName: 'Voss', aliases: ['Voss'] }));

		expect(await resolveTombstonedCanonicalName(LINE, ['Elena Vale', 'VOSS'])).toBeNull();
	});
});
