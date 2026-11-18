import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#lib/logging/logger.ts', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

vi.mock('#lib/db/character-profiles.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/db/character-profiles.ts')>();
	return {
		...actual,
		getLatestProfilesByActLine: vi.fn(actual.getLatestProfilesByActLine),
		getLatestProfileByAlias: vi.fn(actual.getLatestProfileByAlias),
	};
});

vi.mock('#lib/ai/tools/update-character-profile.ts', () => ({
	applyCharacterProfileUpdate: vi.fn(),
	buildUpdateCharacterProfileTools: vi.fn(),
}));

import { createTestDatabase } from '../../../__tests__/helpers/test-database';
import { runMigrations } from '#lib/db/migrations.ts';

let testDb: ReturnType<typeof createTestDatabase>;
vi.mock('#lib/db/database.ts', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

import { getLatestProfileByAlias, getLatestProfilesByActLine, insertCharacterProfile } from '#lib/db/character-profiles.ts';
import { getProfileUpdateLabels, type ProfileUpdateLabels } from '#lib/definitions/pipeline-prompts.ts';
import { parseProfileUpdates, validateProfileUpdateTargets } from '#lib/ai/pipeline/character-profile-updates.ts';
import { loadLocaleStrings } from '#lib/localization/index.ts';
import { applyCharacterProfileUpdate } from '#lib/ai/tools/update-character-profile.ts';

const LINE = 'line-1';

function labels(): ProfileUpdateLabels {
	return getProfileUpdateLabels();
}

function envelope(count: number): string {
	const l = labels();
	return `# ${l.envelope}\n- ${l.count}: ${count}`;
}

function record(name: string, lines: string[] = []): string {
	return `## ${name}${lines.length ? '\n' + lines.join('\n') : ''}`;
}

function scalar(field: keyof ProfileUpdateLabels['fields'], value: string): string {
	return `- ${labels().fields[field]}: ${value}`;
}

function collection(field: 'aliases' | 'traits', items: string[]): string {
	return `### ${labels().fields[field]}\n${items.map((i) => `- ${i}`).join('\n')}`;
}

function clears(fields: Array<'logline' | 'state' | 'goal' | 'relationships' | 'voice' | 'traits'>): string {
	return `### ${labels().clearFields}\n${fields.map((f) => `- ${labels().fields[f]}`).join('\n')}`;
}

function doc(count: number, records: string[], separator = '\n\n'): string {
	return [envelope(count), ...records].join(separator);
}

async function seed(
	name: string,
	options: {
		canonicalName?: string;
		aliases?: string[];
		scene?: number;
		removed?: boolean;
		importance?: 1 | 2 | 3 | 4;
		id?: string;
	} = {}
): Promise<void> {
	await insertCharacterProfile({
		id: options.id ?? crypto.randomUUID(),
		actLineId: LINE,
		sceneNumber: options.scene ?? 4,
		canonicalName: options.canonicalName ?? name.toLowerCase().replace(/\s+/g, '-'),
		preferredName: name,
		aliases: options.aliases ?? [name],
		logline: '',
		sceneDetails: '',
		importance: options.importance ?? 4,
		removed: options.removed,
	});
}

async function snapshot(): Promise<unknown[]> {
	return testDb.select('SELECT * FROM character_profiles ORDER BY id');
}

beforeEach(async () => {
	testDb = createTestDatabase();
	await runMigrations();
	await loadLocaleStrings('en');
	vi.mocked(getLatestProfilesByActLine).mockClear();
	vi.mocked(getLatestProfileByAlias).mockClear();
});

describe('parseProfileUpdates', () => {
	it('distinguishes an absent field from an explicit clear and empty collection', () => {
		const l = getProfileUpdateLabels();
		const text = `# ${l.envelope}\n- ${l.count}: 1\n\n## Elena Vale\n### ${l.fields.aliases}\n### ${l.clearFields}\n- ${l.fields.goal}`;
		const result = parseProfileUpdates(text, l);
		expect(result).toEqual({ ok: true, updates: [{ name: 'Elena Vale', aliases: [], goal: null }] });
		if (result.ok) expect(Object.hasOwn(result.updates[0], 'state')).toBe(false);
	});

	it('parses several records with scalars, preferred name, importance and collections', () => {
		const text = doc(2, [
			record('Elena Vale', [
				scalar('preferredName', 'Elena'),
				scalar('state', 'Wounded'),
				scalar('goal', 'Reach the gate'),
				scalar('importance', '2'),
				collection('aliases', ['Lady Vale', 'Ellie']),
				collection('traits', ['wary', 'quiet']),
			]),
			record('Mara', [scalar('logline', 'A smuggler'), scalar('voice', '"Keep moving."')]),
		]);
		const result = parseProfileUpdates(text, labels());
		expect(result).toEqual({
			ok: true,
			updates: [
				{
					name: 'Elena Vale',
					preferredName: 'Elena',
					state: 'Wounded',
					goal: 'Reach the gate',
					importance: 2,
					aliases: ['Lady Vale', 'Ellie'],
					traits: ['wary', 'quiet'],
				},
				{ name: 'Mara', logline: 'A smuggler', voice: '"Keep moving."' },
			],
		});
	});

	it('accepts an empty valid envelope with count 0 as a no-op', () => {
		expect(parseProfileUpdates(envelope(0), labels())).toEqual({ ok: true, updates: [] });
	});

	it('parses a name-only record', () => {
		expect(parseProfileUpdates(doc(1, [record('Elena Vale')]), labels())).toEqual({
			ok: true,
			updates: [{ name: 'Elena Vale' }],
		});
	});

	it('preserves indented multiline scalar text literally', () => {
		const text = doc(1, [record('Elena Vale', [`- ${labels().fields.state}: Wounded,`, '  hiding in the mill.'])]);
		const result = parseProfileUpdates(text, labels());
		expect(result).toEqual({ ok: true, updates: [{ name: 'Elena Vale', state: 'Wounded,\nhiding in the mill.' }] });
	});

	it('preserves punctuation and dotted names literally', () => {
		const name = "Dr. Elena M. O'Brien, Jr.";
		const result = parseProfileUpdates(doc(1, [record(name)]), labels());
		expect(result).toEqual({ ok: true, updates: [{ name }] });
	});

	it('never interprets literal null, none or [] as clearing or emptiness', () => {
		const text = doc(1, [
			record('Elena Vale', [
				scalar('goal', 'null'),
				scalar('state', 'none'),
				scalar('relationships', '[]'),
				collection('traits', ['none', '[]']),
			]),
		]);
		const result = parseProfileUpdates(text, labels());
		expect(result).toEqual({
			ok: true,
			updates: [{ name: 'Elena Vale', goal: 'null', state: 'none', relationships: '[]', traits: ['none', '[]'] }],
		});
	});

	it('turns a supplied empty scalar into an empty string, never null', () => {
		const text = doc(1, [record('Elena Vale', [`- ${labels().fields.goal}:`])]);
		expect(parseProfileUpdates(text, labels())).toEqual({ ok: true, updates: [{ name: 'Elena Vale', goal: '' }] });
	});

	it('keeps an absent collection absent and an empty collection empty', () => {
		const text = doc(1, [record('Elena Vale', [scalar('state', 'Wounded'), collection('aliases', [])])]);
		const result = parseProfileUpdates(text, labels());
		expect(result).toEqual({ ok: true, updates: [{ name: 'Elena Vale', aliases: [], state: 'Wounded' }] });
		if (result.ok) {
			expect(Object.hasOwn(result.updates[0], 'traits')).toBe(false);
		}
	});

	it('does not truncate more than ten traits', () => {
		const traits = Array.from({ length: 12 }, (_, i) => `trait ${i + 1}`);
		const result = parseProfileUpdates(doc(1, [record('Elena Vale', [collection('traits', traits)])]), labels());
		expect(result).toEqual({ ok: true, updates: [{ name: 'Elena Vale', traits }] });
	});

	it.each([
		['unknown scalar label', record('Elena Vale', ['- Mood: happy'])],
		['scalar without a value separator', record('Elena Vale', [`- ${labels().fields.goal}`])],
		['unknown level-three section', record('Elena Vale', ['### Mood\n- happy'])],
		['unknown clear field', record('Elena Vale', [`### ${labels().clearFields}\n- ${labels().fields.importance}`])],
		['blank preferred name', record('Elena Vale', [`- ${labels().fields.preferredName}:   `])],
		['importance below range', record('Elena Vale', [scalar('importance', '0')])],
		['importance above range', record('Elena Vale', [scalar('importance', '5')])],
		['non-integer importance', record('Elena Vale', [scalar('importance', '2.5')])],
		['non-numeric importance', record('Elena Vale', [scalar('importance', 'high')])],
	])('rejects %s without returning updates', (_label, block) => {
		const result = parseProfileUpdates(doc(1, [block]), labels());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
	});

	it.each([
		['missing envelope', record('Elena Vale')],
		['missing count', envelope(0).split('\n')[0]],
		['non-integer count', `# ${labels().envelope}\n- ${labels().count}: two`],
		['count mismatch', doc(2, [record('Elena Vale')])],
		['count zero with a record', doc(0, [record('Elena Vale')])],
		['extra count item', `${envelope(0)}\n- two`],
		['unknown envelope heading', `# Something Else\n- ${labels().count}: 0`],
		['second envelope', `${doc(0, [])}\n\n# ${labels().envelope}\n- ${labels().count}: 0`],
		['record before the count list', `# ${labels().envelope}\n\n## Elena Vale\n- ${labels().count}: 0`],
	])('rejects an invalid envelope: %s', (_label, text) => {
		const result = parseProfileUpdates(text, labels());
		expect(result.ok).toBe(false);
	});

	it.each([
		['fenced code', '```\nx\n```'],
		['horizontal rule', '---'],
		['prose paragraph', 'A stray note.'],
		['blockquote', '> quoted'],
		['html block', '<div>raw</div>'],
		['nested list', `- ${labels().fields.state}: Wounded\n  - nested`],
		['task list', `- [ ] ${labels().fields.state}: Wounded`],
		['deep heading', '#### Deep'],
		['collection heading without a record', `### ${labels().fields.aliases}\n- Ellie`],
		['trailing content', `${record('Elena Vale', [scalar('state', 'Wounded')])}\n\nA trailing note.`],
	])('rejects disallowed structure: %s', (_label, content) => {
		const text =
			content.startsWith('#') || content.startsWith('```') || content.startsWith('>') || content.startsWith('<')
				? `${envelope(1)}\n\n${content}`
				: doc(1, [content.startsWith('##') || content.startsWith('###') ? content : record('Elena Vale', [content])]);
		const result = parseProfileUpdates(text, labels());
		expect(result.ok).toBe(false);
	});

	it.each([
		['blockquote', ['  > quoted']],
		['html block', ['  <div>raw</div>']],
		['horizontal rule', ['  ---']],
		['heading', ['  #### Deep']],
		['fenced code', ['  ```', '  x', '  ```']],
	])('rejects a nested %s inside a scalar item', (_label, extra) => {
		const text = doc(1, [record('Elena Vale', [`- ${labels().fields.state}: Wounded`, ...extra])]);
		expect(parseProfileUpdates(text, labels()).ok).toBe(false);
	});

	it.each([
		['blockquote', ['  > quoted']],
		['html block', ['  <div>raw</div>']],
		['horizontal rule', ['  ---']],
		['heading', ['  #### Deep']],
		['fenced code', ['  ```', '  x', '  ```']],
	])('rejects a nested %s inside a collection item', (_label, extra) => {
		const text = doc(1, [record('Elena Vale', [`### ${labels().fields.aliases}`, '- Ellie', ...extra])]);
		expect(parseProfileUpdates(text, labels()).ok).toBe(false);
	});

	it('rejects duplicate records, labels, sections, items and clears', () => {
		const l = labels();
		const cases = [
			doc(2, [record('Elena Vale'), record('elena vale')]),
			doc(1, [record('Elena Vale', [scalar('state', 'a'), scalar('state', 'b')])]),
			doc(1, [record('Elena Vale', [collection('aliases', ['A']), collection('aliases', ['B'])])]),
			doc(1, [record('Elena Vale', [collection('traits', ['brave', 'brave'])])]),
			doc(1, [record('Elena Vale', [`### ${l.clearFields}\n- ${l.fields.goal}\n- ${l.fields.goal}`])]),
			doc(1, [record('Elena Vale', [scalar('goal', 'x'), clears(['goal'])])]),
			doc(1, [record('Elena Vale', [collection('traits', ['brave']), clears(['traits'])])]),
		];
		for (const text of cases) {
			const result = parseProfileUpdates(text, labels());
			expect(result.ok).toBe(false);
		}
	});

	it('rejects a valid first record followed by a malformed second record as a whole batch', async () => {
		const before = await snapshot();
		const text = doc(2, [record('Elena Vale', [scalar('state', 'Wounded')]), record('Mara', ['- Mood: sly'])]);
		const result = parseProfileUpdates(text, labels());
		expect(result.ok).toBe(false);
		expect(result).not.toHaveProperty('updates');
		expect(await snapshot()).toEqual(before);
	});

	it('cannot turn record names into object paths', () => {
		const result = parseProfileUpdates(doc(1, [record('__proto__.polluted')]), labels());
		expect(result).toEqual({ ok: true, updates: [{ name: '__proto__.polluted' }] });
		if (result.ok) {
			expect(Object.getPrototypeOf(result.updates[0])).toBe(Object.prototype);
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
			expect(Object.hasOwn(result.updates[0], 'polluted')).toBe(false);
		}
	});

	it('accepts all integer importance levels 1-4', () => {
		const text = doc(
			4,
			[1, 2, 3, 4].map((n) => record(`Person ${n}`, [scalar('importance', String(n))]))
		);
		const result = parseProfileUpdates(text, labels());
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.updates.map((u) => u.importance)).toEqual([1, 2, 3, 4]);
	});

	describe.each(['en', 'zh-Hant-HK'])('production labels (%s)', (locale) => {
		beforeEach(async () => {
			await loadLocaleStrings(locale);
		});

		it('resolves the new labels from locale strings instead of returning raw keys', () => {
			const l = labels();
			expect(l.envelope).not.toBe('pipeline.headers.characterProfileUpdates');
			expect(l.clearFields).not.toBe('pipeline.headers.clearFields');
			expect(l.count).not.toBe('pipeline.labels.updateCount');
			expect(l.fields.preferredName).not.toBe('pipeline.labels.preferredName');
			for (const value of [l.envelope, l.clearFields, l.count, l.fields.preferredName]) expect(value.trim()).not.toBe('');
		});

		it('round-trips a multi-record batch built from the production labels', () => {
			const text = doc(2, [
				record('Elena Vale', [scalar('state', 'Wounded'), scalar('goal', ''), collection('aliases', ['Silent Vane']), clears(['logline'])]),
				record('Mara', [scalar('importance', '1'), collection('traits', ['bold'])]),
			]);
			const result = parseProfileUpdates(text, labels());
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.updates[0]).toMatchObject({ name: 'Elena Vale', state: 'Wounded', goal: '', logline: null });
				expect(result.updates[1]).toMatchObject({ name: 'Mara', importance: 1, traits: ['bold'] });
				expect(Object.hasOwn(result.updates[0], 'aliases')).toBe(true);
			}
		});

		it('rejects the same malformed content regardless of locale', () => {
			const result = parseProfileUpdates(doc(1, [record('Elena Vale', ['- Mood: happy'])]), labels());
			expect(result.ok).toBe(false);
		});
	});
});

describe('validateProfileUpdateTargets', () => {
	it('resolves existing identities through their aliases without altering the input', async () => {
		await seed('Elena Vale', { canonicalName: 'elena-vale', aliases: ['Elena Vale', 'Lady Vale'] });
		const updates = [{ name: 'Lady Vale', state: 'Recovered' }];
		const result = await validateProfileUpdateTargets(LINE, updates);
		expect(result).toEqual({ ok: true, updates });
		expect(updates).toEqual([{ name: 'Lady Vale', state: 'Recovered' }]);
	});

	it('rejects two updates that resolve to the same canonical target', async () => {
		await seed('Elena Vale', { canonicalName: 'elena-vale', aliases: ['Elena Vale', 'Lady Vale'] });
		const result = await validateProfileUpdateTargets(LINE, [
			{ name: 'Elena Vale', state: 'a' },
			{ name: 'Lady Vale', state: 'b' },
		]);
		expect(result.ok).toBe(false);
	});

	it('rejects a later lookup changed by an earlier alias addition', async () => {
		await seed('Elena Vale', { canonicalName: 'elena-vale', aliases: ['Elena Vale', 'Scout'] });
		const result = await validateProfileUpdateTargets(LINE, [
			{ name: 'Elena Vale', aliases: ['Wanderer'] },
			{ name: 'Wanderer', state: 'Wounded' },
		]);
		expect(result.ok).toBe(false);
	});

	it('rejects a newly introduced cross-identity naming collision', async () => {
		await seed('Elena Vale', { canonicalName: 'elena-vale', aliases: ['Elena Vale', 'Lady Vale'] });
		const result = await validateProfileUpdateTargets(LINE, [{ name: 'Mara', aliases: ['Lady Vale'] }]);
		expect(result.ok).toBe(false);
	});

	it('rejects a new identity whose supplied names collide with an existing identity', async () => {
		await seed('Elena Vale', { canonicalName: 'elena-vale', aliases: ['Elena Vale', 'Silent Vane'] });
		const result = await validateProfileUpdateTargets(LINE, [{ name: 'Sera', preferredName: 'Silent Vane' }]);
		expect(result.ok).toBe(false);
	});

	it('preserves baseline resolution for unrelated pre-existing shared aliases', async () => {
		await seed('Elena Vale', { canonicalName: 'elena-vale', aliases: ['Elena Vale', 'Captain'], scene: 4 });
		await seed('Mara', { canonicalName: 'mara', aliases: ['Mara', 'Captain'], scene: 9 });
		expect((await getLatestProfileByAlias(LINE, 'Captain'))?.canonicalName).toBe('mara');

		const result = await validateProfileUpdateTargets(LINE, [
			{ name: 'Elena Vale', state: 'Wounded' },
			{ name: 'Captain', state: 'Calm' },
		]);
		expect(result.ok).toBe(true);
	});

	it('rejects an addition that makes a later lookup newly ambiguous', async () => {
		await seed('Elena Vale', { canonicalName: 'elena-vale', aliases: ['Elena Vale', 'Captain'], scene: 4 });
		await seed('Mara', { canonicalName: 'mara', aliases: ['Mara', 'Captain'], scene: 9 });
		const result = await validateProfileUpdateTargets(LINE, [
			{ name: 'Elena Vale', state: 'Wounded' },
			{ name: 'Sera', aliases: ['Captain'] },
		]);
		expect(result.ok).toBe(false);
	});

	it('does not revive a removed profile as a target', async () => {
		await seed('Ghost', { canonicalName: 'ghost', aliases: ['Ghost'], removed: true });
		expect(await getLatestProfilesByActLine(LINE)).toEqual([]);
		const result = await validateProfileUpdateTargets(LINE, [{ name: 'Ghost', state: 'Haunting' }]);
		expect(result.ok).toBe(true);
	});

	it('accepts an empty batch without touching the database', async () => {
		await seed('Elena Vale', { canonicalName: 'elena-vale' });
		const before = await snapshot();
		const result = await validateProfileUpdateTargets(LINE, []);
		expect(result).toEqual({ ok: true, updates: [] });
		expect(await snapshot()).toEqual(before);
	});

	it('simulates the cleaned preferred name for a bracketed heading fallback', async () => {
		// WHY: the write path strips brackets before storing, so the simulation must
		// treat "[Vane]" as "Vane" or a later update could resolve differently.
		const result = await validateProfileUpdateTargets(LINE, [{ name: '[Vane]' }, { name: 'Vane', state: 'Watching' }]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0]).toContain('earlier updates changed which identity this name resolves to');
	});

	it('leaves storage untouched when a batch is rejected', async () => {
		await seed('Elena Vale', { canonicalName: 'elena-vale', aliases: ['Elena Vale', 'Lady Vale'] });
		const before = await snapshot();
		const result = await validateProfileUpdateTargets(LINE, [
			{ name: 'Elena Vale', state: 'Wounded' },
			{ name: 'Lady Vale', goal: null },
		]);
		expect(result.ok).toBe(false);
		expect(await snapshot()).toEqual(before);
	});

	it('rejects database exceptions instead of turning them into formatting errors', async () => {
		vi.mocked(getLatestProfilesByActLine).mockRejectedValueOnce(new Error('db down'));
		await expect(validateProfileUpdateTargets(LINE, [{ name: 'Elena Vale' }])).rejects.toThrow('db down');
	});

	it('never attempts a profile update while parsing or validating', async () => {
		await seed('Elena Vale', { canonicalName: 'elena-vale', aliases: ['Elena Vale', 'Lady Vale'] });
		parseProfileUpdates(doc(1, [record('Elena Vale', ['- Mood: happy'])]), labels());
		await validateProfileUpdateTargets(LINE, [
			{ name: 'Elena Vale', state: 'Wounded' },
			{ name: 'Lady Vale', goal: null },
		]);
		expect(vi.mocked(applyCharacterProfileUpdate)).not.toHaveBeenCalled();
	});
});

describe('ProfileUpdateInput compatibility', () => {
	it('returns updates assignable to the Task 1 input type', () => {
		const result = parseProfileUpdates(doc(1, [record('Elena Vale', [scalar('state', 'Wounded')])]), labels());
		expect(result.ok).toBe(true);
		if (result.ok) {
			const first: import('#lib/ai/pipeline/types.ts').ProfileUpdateInput = result.updates[0];
			expect(first.name).toBe('Elena Vale');
			expect(first.state).toBe('Wounded');
		}
	});
});
