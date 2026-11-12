import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#lib/definitions/common-headers.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	actSummaryHeader: () => 'Act Summary',
	turnOfEventsHeader: () => 'Turn Of Events',
	summaryHeader: () => 'Summary',
}));
vi.mock('#lib/definitions/common-labels.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	sceneWithNumberLabel: (n: number | string) => `Scene ${n}`,
	locationLabel: () => 'Location',
	aliasesLabel: () => 'Aliases',
	lastUpdateLabel: () => 'Last update',
}));
vi.mock('#lib/definitions/pipeline-prompts.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	sceneSummariesHeader: () => 'Scene Summaries',
	characterSummariesHeader: () => 'Character Summaries',
	characterProfilesHeader: () => 'Character Profiles',
	characterSummariesSinceSceneLabel: (n: number) => `Summaries of each character for recent Scenes since Scene ${n}.`,
}));
vi.mock('#lib/definitions/character-profile-labels.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	stateLabel: () => 'State',
	loglineLabel: () => 'Logline',
	goalLabel: () => 'Goal',
	relationshipsLabel: () => 'Relationships',
	voiceLabel: () => 'Voice',
	traitsLabel: () => 'Traits',
	importanceLabel: () => 'Importance',
}));

vi.mock('#lib/logging/logger.ts', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

import { createTestDatabase } from './helpers/test-database';
import { runMigrations } from '#lib/db/migrations.ts';

let testDb: ReturnType<typeof createTestDatabase>;
vi.mock('#lib/db/database.ts', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

import { insertCharacterProfile, getLatestProfileByAlias, getLatestProfilesByActLine } from '#lib/db/character-profiles.ts';
import { buildUpdateCharacterProfileTools } from '#lib/ai/tools/update-character-profile.ts';
import { parseActSummary } from '#lib/ai/act-summary-parser.ts';
import type { ProfileCompressionState } from '#lib/ai/pipeline/types.ts';
import type { ToolContext } from '#lib/ai/tools/tools.ts';

const LINE = 'line-1';

function holder(overrides: Partial<ProfileCompressionState> = {}): ProfileCompressionState {
	return { completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0, ...overrides };
}

function ctx(): ToolContext {
	return { story: { id: 'story-1' }, actLine: { id: LINE }, act: { id: 'act-1' } } as never;
}

async function seedProfile(): Promise<void> {
	await insertCharacterProfile({
		id: 'p1',
		actLineId: LINE,
		sceneNumber: 4,
		canonicalName: 'elena-vale',
		preferredName: 'Elena Vale',
		aliases: ['Elena Vale', 'Lady Vale'],
		logline: 'A wary scout',
		state: 'Wounded',
		goal: 'Reach the gate',
		relationships: null,
		voice: '"Keep moving."',
		traits: ['wary', 'quiet'],
		sceneDetails: '- 4: Scouts ahead',
		importance: 2,
	});
}

async function execute(compression: ProfileCompressionState, input: Record<string, unknown>): Promise<string> {
	const tools = buildUpdateCharacterProfileTools(ctx(), compression);
	return tools['update-character-profile'].execute!(input as never, {} as never);
}

beforeEach(async () => {
	testDb = createTestDatabase();
	await runMigrations();
});

describe('update-character-profile execute', () => {
	it('omitted fields inherit the latest version (tri-state)', async () => {
		await seedProfile();
		const h = holder();
		await execute(h, { name: 'elena-vale', state: 'Recovered' });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.state).toBe('Recovered');
		expect(latest?.goal).toBe('Reach the gate');
		expect(latest?.voice).toBe('"Keep moving."');
		expect(latest?.traits).toEqual(['wary', 'quiet']);
		expect(latest?.importance).toBe(2);
		expect(latest?.sceneNumber).toBe(9);
		expect(h.successCount).toBe(1);
		expect(h.attemptCount).toBe(1);
	});

	it('explicit null clears a text field; empty traits clears traits', async () => {
		await seedProfile();
		await execute(holder(), { name: 'elena-vale', goal: null, traits: [] });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.goal).toBeNull();
		expect(latest?.traits).toEqual([]);
		expect(latest?.state).toBe('Wounded');
	});

	it('logline null clears to empty string (NOT NULL column — documented deviation)', async () => {
		await seedProfile();
		await execute(holder(), { name: 'elena-vale', logline: null });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.logline).toBe('');
	});

	it('empty name fails without inserting; attempt counted, success not', async () => {
		const h = holder();
		const result = await execute(h, { name: '   ' });
		expect(result.toLowerCase()).toContain('failed');
		expect(h.attemptCount).toBe(1);
		expect(h.successCount).toBe(0);
		expect(await getLatestProfilesByActLine(LINE)).toHaveLength(0);
	});

	it('alias-keyed call resolves to the existing canonical; aliases are additive', async () => {
		await seedProfile();
		await execute(holder(), { name: 'Lady Vale', aliases: ['The Scout'], preferredName: 'Elena V.' });
		const latest = await getLatestProfileByAlias(LINE, 'The Scout');
		expect(latest?.canonicalName).toBe('elena-vale');
		expect(latest?.preferredName).toBe('Elena V.');
		expect(latest?.aliases).toContain('Lady Vale');
		expect(latest?.aliases).toContain('Elena Vale');
		expect(latest?.aliases[0]).toBe('Elena V.');
	});

	it('creation defaults: importance 4, derived canonical, preferred in aliases', async () => {
		await execute(holder(), { name: 'New Guard', logline: 'A watchful sentry' });
		const latest = await getLatestProfileByAlias(LINE, 'New Guard');
		expect(latest?.canonicalName).toBe('new-guard');
		expect(latest?.importance).toBe(4);
		expect(latest?.aliases).toContain('New Guard');
		expect(latest?.state).toBeNull();
	});

	it('revival rederives identity — erased version is not inherited', async () => {
		await seedProfile();
		await testDb.execute('UPDATE character_profiles SET removed = 1 WHERE id = $1', ['p1']);
		await execute(holder(), { name: 'Elena Vale', logline: 'Returned from exile' });
		const rows = await testDb.select<{ canonical_name: string; removed: number }[]>(
			'SELECT canonical_name, removed FROM character_profiles ORDER BY created_at'
		);
		const active = rows.filter((r) => r.removed === 0);
		expect(active).toHaveLength(1);
		expect(active[0].canonical_name).toBe('elena-vale');
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.aliases).toEqual(['Elena Vale']);
	});

	it('sceneDetails derived from the holder summary at call time', async () => {
		const summary = parseActSummary(
			'# Act Summary\n\n## Character Summaries\n\n### Elena Vale\n- Aliases: [Elena Vale]\n- Scene 9: Opens the gate.'
		);
		await execute(holder({ newActSummary: summary }), { name: 'Elena Vale' });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.sceneDetails).toContain('9');
		expect(latest?.sceneDetails).toContain('Opens the gate');
	});

	it('errors become tool results; attempt counted, success not; no throw', async () => {
		const h = holder();
		testDb.close();
		const result = await execute(h, { name: 'Anyone' });
		expect(typeof result).toBe('string');
		expect(result.toLowerCase()).toContain('failed');
		expect(h.attemptCount).toBe(1);
		expect(h.successCount).toBe(0);
	});
});
