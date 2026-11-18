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
import { applyCharacterProfileUpdate, buildUpdateCharacterProfileTools } from '#lib/ai/tools/update-character-profile.ts';
import { parseActSummary } from '#lib/ai/act-summary-parser.ts';
import { loadLocaleStrings } from '#lib/localization/index.ts';
import type { ProfileCompressionState, ProfileUpdateInput } from '#lib/ai/pipeline/types.ts';
import type { ToolContext } from '#lib/ai/tools/tools.ts';

const LINE = 'line-1';
const MODES = ['tool', 'direct'] as const;
type Mode = (typeof MODES)[number];

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

async function invoke(
	mode: Mode,
	compression: ProfileCompressionState,
	input: ProfileUpdateInput,
	abortSignal?: AbortSignal
): Promise<string> {
	if (mode === 'direct') return applyCharacterProfileUpdate(LINE, compression, input, abortSignal);
	const tools = buildUpdateCharacterProfileTools(ctx(), compression);
	return tools['update-character-profile'].execute!(input as never, { abortSignal } as never);
}

beforeEach(async () => {
	testDb = createTestDatabase();
	await runMigrations();
	await loadLocaleStrings('en');
});

it('shares additive aliases and delta clears with the tool transport', async () => {
	await seedProfile();
	const h = holder();
	await applyCharacterProfileUpdate(LINE, h, { name: 'Lady Vale', preferredName: 'Vane', aliases: [], goal: null, traits: [] }, undefined);
	const latest = await getLatestProfileByAlias(LINE, 'Lady Vale');
	expect(latest).toMatchObject({
		canonicalName: 'elena-vale',
		preferredName: 'Vane',
		state: 'Wounded',
		goal: null,
		traits: [],
	});
	expect(latest?.aliases).toEqual(['Vane', 'Elena Vale', 'Lady Vale']);
	expect(h).toMatchObject({ attemptCount: 1, successCount: 1 });
});

it('duplicate same-identity calls merge sequentially; both versions kept, latest wins', async () => {
	// Why: smoke runs showed the model emitting the same call twice; each call must
	// inherit the previous version's fields and append a new version row (design §5.3).
	const nowSpy = vi.spyOn(Date, 'now');
	nowSpy.mockReturnValue(1000);
	await seedProfile();
	const h = holder();
	nowSpy.mockReturnValue(2000);
	await invoke('tool', h, { name: 'Elena Vale', state: 'Recovered' });
	nowSpy.mockReturnValue(3000);
	await invoke('tool', h, { name: 'Elena Vale', goal: 'Hold the gate' });
	nowSpy.mockRestore();

	const rows = await testDb.select<{ state: string | null; goal: string | null; scene_number: number }[]>(
		'SELECT state, goal, scene_number FROM character_profiles WHERE act_line_id = $1 AND canonical_name = $2 ORDER BY created_at',
		[LINE, 'elena-vale']
	);
	expect(rows).toHaveLength(3);
	expect(rows[1]).toMatchObject({ state: 'Recovered', goal: 'Reach the gate', scene_number: 9 });
	expect(rows[2]).toMatchObject({ state: 'Recovered', goal: 'Hold the gate', scene_number: 9 });
	const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
	expect(latest?.state).toBe('Recovered');
	expect(latest?.goal).toBe('Hold the gate');
	expect(h.successCount).toBe(2);
	expect(h.attemptCount).toBe(2);
});

describe.each(MODES)('update-character-profile (%s invocation)', (mode) => {
	it('omitted fields inherit the latest version (tri-state)', async () => {
		await seedProfile();
		const h = holder();
		await invoke(mode, h, { name: 'elena-vale', state: 'Recovered' });
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
		await invoke(mode, holder(), { name: 'elena-vale', goal: null, traits: [] });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.goal).toBeNull();
		expect(latest?.traits).toEqual([]);
		expect(latest?.state).toBe('Wounded');
	});

	it('logline null clears to empty string (NOT NULL column — documented deviation)', async () => {
		await seedProfile();
		await invoke(mode, holder(), { name: 'elena-vale', logline: null });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.logline).toBe('');
	});

	it('supplied text replaces the entire previous value; empty string replaces too', async () => {
		await seedProfile();
		await invoke(mode, holder(), { name: 'elena-vale', goal: 'Hold the line', voice: '' });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.goal).toBe('Hold the line');
		expect(latest?.voice).toBe('');
	});

	it('supplied traits replace the entire previous list rather than merging', async () => {
		await seedProfile();
		await invoke(mode, holder(), { name: 'elena-vale', traits: ['bold'] });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.traits).toEqual(['bold']);
	});

	it('aliases stay additive while traits clear', async () => {
		await seedProfile();
		await invoke(mode, holder(), { name: 'elena-vale', aliases: [], traits: [] });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.aliases).toEqual(['Elena Vale', 'Lady Vale']);
		expect(latest?.traits).toEqual([]);
	});

	it('normalized traits are trimmed, deduped and capped at 10', async () => {
		await seedProfile();
		await invoke(mode, holder(), {
			name: 'elena-vale',
			traits: [' bold ', 'bold', 'wary', 'quiet', 'kind', 'brave', 'calm', 'sharp', 'loyal', 'proud', 'stern', 'swift'],
		});
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.traits).toEqual(['bold', 'wary', 'quiet', 'kind', 'brave', 'calm', 'sharp', 'loyal', 'proud', 'stern']);
	});

	it('empty name fails without inserting; attempt counted, success not', async () => {
		const h = holder();
		const result = await invoke(mode, h, { name: '   ' });
		expect(result.toLowerCase()).toContain('failed');
		expect(h.attemptCount).toBe(1);
		expect(h.successCount).toBe(0);
		expect(await getLatestProfilesByActLine(LINE)).toHaveLength(0);
	});

	it('alias-keyed call resolves to the existing canonical; aliases are additive', async () => {
		await seedProfile();
		await invoke(mode, holder(), { name: 'Lady Vale', aliases: ['The Scout'], preferredName: 'Elena V.' });
		const latest = await getLatestProfileByAlias(LINE, 'The Scout');
		expect(latest?.canonicalName).toBe('elena-vale');
		expect(latest?.preferredName).toBe('Elena V.');
		expect(latest?.aliases).toContain('Lady Vale');
		expect(latest?.aliases).toContain('Elena Vale');
		expect(latest?.aliases[0]).toBe('Elena V.');
	});

	it('bracketed preferred name is revealed and leads the aliases', async () => {
		await seedProfile();
		await invoke(mode, holder(), { name: 'elena-vale', preferredName: '[Elena the Bold]' });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.preferredName).toBe('Elena the Bold');
		expect(latest?.aliases[0]).toBe('Elena the Bold');
		expect(latest?.canonicalName).toBe('elena-vale');
	});

	it('creation defaults: importance 4, derived canonical, preferred in aliases', async () => {
		await invoke(mode, holder(), { name: 'New Guard', logline: 'A watchful sentry' });
		const latest = await getLatestProfileByAlias(LINE, 'New Guard');
		expect(latest?.canonicalName).toBe('new-guard');
		expect(latest?.importance).toBe(4);
		expect(latest?.aliases).toContain('New Guard');
		expect(latest?.state).toBeNull();
	});

	it('name-only update inherits everything and preserves the historical row', async () => {
		await seedProfile();
		await invoke(mode, holder(), { name: 'Elena Vale' });
		const rows = await testDb.select<{ state: string | null; goal: string | null; scene_number: number }[]>(
			'SELECT state, goal, scene_number FROM character_profiles WHERE act_line_id = $1 AND canonical_name = $2 ORDER BY rowid',
			[LINE, 'elena-vale']
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ state: 'Wounded', goal: 'Reach the gate', scene_number: 4 });
		expect(rows[1]).toMatchObject({ state: 'Wounded', goal: 'Reach the gate', scene_number: 9 });
	});

	it('revival rederives identity — erased version is not inherited', async () => {
		await seedProfile();
		await testDb.execute('UPDATE character_profiles SET removed = 1 WHERE id = $1', ['p1']);
		await invoke(mode, holder(), { name: 'Elena Vale', logline: 'Returned from exile' });
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
		await invoke(mode, holder({ newActSummary: summary }), { name: 'Elena Vale' });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.sceneDetails).toContain('9');
		expect(latest?.sceneDetails).toContain('Opens the gate');
	});

	it('sceneDetails stay empty when the summary has no matching character', async () => {
		const summary = parseActSummary(
			'# Act Summary\n\n## Character Summaries\n\n### Other Guard\n- Aliases: [Other Guard]\n- Scene 9: Stands watch.'
		);
		await invoke(mode, holder({ newActSummary: summary }), { name: 'Elena Vale' });
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.sceneDetails).toBe('');
	});

	it('observer throwing never fails the applied update', async () => {
		await seedProfile();
		const h = holder({
			onAttempt: () => {
				throw new Error('observer exploded');
			},
		});
		const result = await invoke(mode, h, { name: 'elena-vale', state: 'Recovered' });
		expect(result).toContain('elena-vale');
		expect(h.successCount).toBe(1);
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.state).toBe('Recovered');
	});

	it('lookup/write failure becomes a failed result without success or throw', async () => {
		const h = holder();
		testDb.close();
		const result = await invoke(mode, h, { name: 'Anyone' });
		expect(typeof result).toBe('string');
		expect(result.toLowerCase()).toContain('failed');
		expect(h.attemptCount).toBe(1);
		expect(h.successCount).toBe(0);
	});

	it('write failure alone reports failure and leaves history untouched', async () => {
		await seedProfile();
		const h = holder();
		const realExecute = testDb.execute.bind(testDb);
		testDb.execute = (async (query: string, params?: unknown[]) => {
			if (query.startsWith('INSERT INTO character_profiles')) throw new Error('disk full');
			return realExecute(query, params);
		}) as typeof testDb.execute;
		try {
			const result = await invoke(mode, h, { name: 'elena-vale', state: 'Recovered' });
			expect(result.toLowerCase()).toContain('failed');
			expect(h.attemptCount).toBe(1);
			expect(h.successCount).toBe(0);
			expect(await getLatestProfilesByActLine(LINE)).toHaveLength(1);
		} finally {
			testDb.execute = realExecute as typeof testDb.execute;
		}
	});

	it('already-aborted signal cancels before counting an attempt', async () => {
		await seedProfile();
		const h = holder();
		const controller = new AbortController();
		controller.abort();
		await expect(invoke(mode, h, { name: 'elena-vale', state: 'Recovered' }, controller.signal)).rejects.toThrow();
		expect(h.attemptCount).toBe(0);
		expect(h.successCount).toBe(0);
		expect(await getLatestProfilesByActLine(LINE)).toHaveLength(1);
	});

	it('cancellation during lookup prevents insertion and manufactured results', async () => {
		await seedProfile();
		const h = holder();
		const onAttempt = vi.fn();
		h.onAttempt = onAttempt;
		const controller = new AbortController();
		const realSelect = testDb.select.bind(testDb);
		testDb.select = (async (...args: Parameters<typeof realSelect>) => {
			controller.abort();
			return realSelect(...args);
		}) as typeof testDb.select;
		try {
			await expect(invoke(mode, h, { name: 'elena-vale', state: 'Recovered' }, controller.signal)).rejects.toThrow();
			expect(h.attemptCount).toBe(1);
			expect(h.successCount).toBe(0);
			expect(onAttempt).not.toHaveBeenCalled();
			expect(await getLatestProfilesByActLine(LINE)).toHaveLength(1);
		} finally {
			testDb.select = realSelect as typeof testDb.select;
		}
	});
});
