import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockDbSelectResults: unknown[] = [];
const mockDb = {
	execute: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowsAffected: 0 })),
	select: vi.fn(async (_query: string, _params?: unknown[]) => {
		if (mockDbSelectResults.length > 0) {
			return mockDbSelectResults.shift();
		}
		return [];
	}),
};

vi.mock('$lib/db/database', () => ({
	getDatabase: () => mockDb,
}));

describe('character-profiles DB layer', () => {
	let insertCharacterProfile: typeof import('$lib/db/character-profiles').insertCharacterProfile;
	let getLatestProfilesByActLine: typeof import('$lib/db/character-profiles').getLatestProfilesByActLine;
	let getLatestProfileByAlias: typeof import('$lib/db/character-profiles').getLatestProfileByAlias;
	let areAnyCharacterNamesKnown: typeof import('$lib/db/character-profiles').areAnyCharacterNamesKnown;
	let getMaxSceneNumberForActLine: typeof import('$lib/db/character-profiles').getMaxSceneNumberForActLine;
	let deleteCharacterProfilesForActLine: typeof import('$lib/db/character-profiles').deleteCharacterProfilesForActLine;
	let cloneCharacterProfiles: typeof import('$lib/db/character-profiles').cloneCharacterProfiles;
	let inheritProfilesFromActLine: typeof import('$lib/db/character-profiles').inheritProfilesFromActLine;
	let resolveCanonicalName: typeof import('$lib/db/character-profiles').resolveCanonicalName;
	let toCanonicalName: typeof import('$lib/db/character-profiles').toCanonicalName;
	let ensurePreferredInAliases: typeof import('$lib/db/character-profiles').ensurePreferredInAliases;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockDbSelectResults = [];
		vi.resetModules();
		vi.doMock('$lib/db/database', () => ({ getDatabase: () => mockDb }));

		const mod = await import('$lib/db/character-profiles');
		insertCharacterProfile = mod.insertCharacterProfile;
		getLatestProfilesByActLine = mod.getLatestProfilesByActLine;
		getLatestProfileByAlias = mod.getLatestProfileByAlias;
		areAnyCharacterNamesKnown = mod.areAnyCharacterNamesKnown;
		getMaxSceneNumberForActLine = mod.getMaxSceneNumberForActLine;
		deleteCharacterProfilesForActLine = mod.deleteCharacterProfilesForActLine;
		cloneCharacterProfiles = mod.cloneCharacterProfiles;
		inheritProfilesFromActLine = mod.inheritProfilesFromActLine;
		resolveCanonicalName = mod.resolveCanonicalName;
		toCanonicalName = mod.toCanonicalName;
		ensurePreferredInAliases = mod.ensurePreferredInAliases;
	});

	describe('toCanonicalName', () => {
		it('normalizes to kebab-case', () => {
			expect(toCanonicalName('Lady Shadowcrest')).toBe('lady-shadowcrest');
			expect(toCanonicalName("Elena M. O'Brien")).toBe('elena-m-o-brien');
			expect(toCanonicalName('  Captain  Voss  ')).toBe('captain-voss');
		});

		it('handles separators', () => {
			expect(toCanonicalName('A-B_C')).toBe('a-b-c');
		});

		it('collapses multiple separators', () => {
			expect(toCanonicalName('Elena   the   Shadow')).toBe('elena-the-shadow');
		});
	});

	describe('ensurePreferredInAliases', () => {
		it('adds preferredName if missing', () => {
			const result = ensurePreferredInAliases('Elena', ['Shadow']);
			expect(result).toContain('Elena');
			expect(result).toContain('Shadow');
			expect(result).toHaveLength(2);
		});

		it('does not duplicate if preferredName already in aliases', () => {
			const result = ensurePreferredInAliases('Elena', ['Elena', 'Shadow']);
			expect(result.filter((a) => a === 'Elena')).toHaveLength(1);
			expect(result).toHaveLength(2);
		});

		it('handles empty preferredName', () => {
			const result = ensurePreferredInAliases('', ['Shadow']);
			expect(result).toEqual(['Shadow']);
		});
	});

	describe('insertCharacterProfile', () => {
		it('calls execute with INSERT including canonical_name', async () => {
			await insertCharacterProfile({
				id: 'p1',
				actLineId: 'line-1',
				sceneNumber: 5,
				canonicalName: 'elena',
				preferredName: 'Elena',
				aliases: ['E', 'Shadow'],
				logline: 'A determined hero.',
				state: 'Determined',
				sceneDetails: 'Scene 5: Elena fights',
				importance: 2,
			});

			expect(mockDb.execute).toHaveBeenCalledTimes(1);
			const [, params] = mockDb.execute.mock.calls[0] as unknown[] as any[];
			expect(params[0]).toBe('p1');
			expect(params[1]).toBe('line-1');
			expect(params[2]).toBe(5);
			expect(params[3]).toBe('elena');
			expect(params[4]).toBe('Elena');
			expect(params[5]).toBe(JSON.stringify(['E', 'Shadow']));
			expect(params[6]).toBe('A determined hero.');
			expect(params[7]).toBe('Determined');
			expect(params[8]).toBeNull();
			expect(params[9]).toBeNull();
			expect(params[10]).toBeNull();
			expect(params[11]).toBe('Scene 5: Elena fights');
			expect(params[12]).toBe(2);
		});

		it('serializes empty aliases as "[]"', async () => {
			await insertCharacterProfile({
				id: 'p2',
				actLineId: 'line-1',
				sceneNumber: null,
				canonicalName: 'voss',
				preferredName: 'Voss',
				aliases: [],
				logline: 'A gruff captain.',
				state: 'Gruff',
				sceneDetails: '',
				importance: 4,
			});

			const [, params] = mockDb.execute.mock.calls[0] as unknown[] as any[];
			expect(params[5]).toBe('[]');
		});
	});

	describe('getLatestProfilesByActLine', () => {
		it('maps rows to entities with parsed aliases and canonical_name', async () => {
			mockDbSelectResults = [
				[
					{
						id: 'p1',
						act_line_id: 'line-1',
						scene_number: 5,
						canonical_name: 'elena',
						preferred_name: 'Elena',
						aliases: '["E","Shadow"]',
						logline: 'A determined hero.',
						state: 'Determined',
						goal: null,
						relationships: null,
						voice: null,
						scene_details: 'details',
						importance: 2,
						created_at: 1000,
						updated_at: 2000,
					},
				],
			];

			const result = await getLatestProfilesByActLine('line-1');
			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: 'p1',
				actLineId: 'line-1',
				sceneNumber: 5,
				canonicalName: 'elena',
				preferredName: 'Elena',
				aliases: ['E', 'Shadow'],
				logline: 'A determined hero.',
				state: 'Determined',
				goal: null,
				relationships: null,
				voice: null,
				sceneDetails: 'details',
				importance: 2,
				createdAt: 1000,
				updatedAt: 2000,
			});
		});

		it('returns empty array when no profiles', async () => {
			mockDbSelectResults = [[]];
			const result = await getLatestProfilesByActLine('line-1');
			expect(result).toEqual([]);
		});

		it('handles invalid JSON aliases gracefully', async () => {
			mockDbSelectResults = [
				[
					{
						id: 'p1',
						act_line_id: 'line-1',
						scene_number: null,
						canonical_name: 'elena',
						preferred_name: 'Elena',
						aliases: 'not json',
						logline: 'A hero.',
						state: 'P',
						goal: null,
						relationships: null,
						voice: null,
						scene_details: '',
						importance: 3,
						created_at: 1000,
						updated_at: 1000,
					},
				],
			];

			const result = await getLatestProfilesByActLine('line-1');
			expect(result[0].aliases).toEqual([]);
		});
	});

	describe('getLatestProfileByAlias', () => {
		it('returns null when no match', async () => {
			mockDbSelectResults = [[]];
			const result = await getLatestProfileByAlias('line-1', 'Unknown');
			expect(result).toBeNull();
		});

		it('returns profile when preferred name matches', async () => {
			mockDbSelectResults = [
				[
					{
						id: 'p1',
						act_line_id: 'line-1',
						scene_number: 3,
						canonical_name: 'elena',
						preferred_name: 'Elena',
						aliases: '["Shadow"]',
						logline: 'A hero.',
						state: 'P',
						goal: null,
						relationships: null,
						voice: null,
						scene_details: 'D',
						importance: 2,
						created_at: 1000,
						updated_at: 1000,
					},
				],
			];

			const result = await getLatestProfileByAlias('line-1', 'Elena');
			expect(result).not.toBeNull();
			expect(result!.preferredName).toBe('Elena');
			expect(result!.canonicalName).toBe('elena');
		});

		it('returns profile when alias matches', async () => {
			mockDbSelectResults = [
				[
					{
						id: 'p1',
						act_line_id: 'line-1',
						scene_number: 3,
						canonical_name: 'elena',
						preferred_name: 'Elena',
						aliases: '["Shadow"]',
						logline: 'A hero.',
						state: 'P',
						goal: null,
						relationships: null,
						voice: null,
						scene_details: 'D',
						importance: 2,
						created_at: 1000,
						updated_at: 1000,
					},
				],
			];

			const result = await getLatestProfileByAlias('line-1', 'Shadow');
			expect(result).not.toBeNull();
			expect(result!.preferredName).toBe('Elena');
		});
	});

	describe('resolveCanonicalName', () => {
		it('returns existing canonical_name when profile found by alias', async () => {
			mockDbSelectResults = [
				[
					{
						id: 'p1',
						act_line_id: 'line-1',
						scene_number: 3,
						canonical_name: 'elena-shadowcrest',
						preferred_name: 'Elena',
						aliases: '["Shadow"]',
						logline: 'A hero.',
						state: 'P',
						goal: null,
						relationships: null,
						voice: null,
						scene_details: 'D',
						importance: 2,
						created_at: 1000,
						updated_at: 1000,
					},
				],
			];

			const result = await resolveCanonicalName('line-1', 'Lady Shadowcrest');
			expect(result).toBe('elena-shadowcrest');
		});

		it('derives canonical_name from preferredName when no existing profile', async () => {
			mockDbSelectResults = [[]];

			const result = await resolveCanonicalName('line-1', 'Lady Shadowcrest');
			expect(result).toBe('lady-shadowcrest');
		});
	});

	describe('areAnyCharacterNamesKnown', () => {
		it('returns true when any name matches a preferred_name', async () => {
			mockDbSelectResults = [[{ found: 1 }]];
			const result = await areAnyCharacterNamesKnown('line-1', ['Elena', 'Voss', 'Unknown']);
			expect(result).toBe(true);
			expect(mockDb.select).toHaveBeenCalledTimes(1);
			const [, params] = mockDb.select.mock.calls[0] as unknown[] as any[];
			expect(params[0]).toBe('line-1');
			expect(params).toContain('Elena');
			expect(params).toContain('Voss');
			expect(params).toContain('Unknown');
		});

		it('returns false when no names match', async () => {
			mockDbSelectResults = [[]];
			const result = await areAnyCharacterNamesKnown('line-1', ['Elena', 'Voss']);
			expect(result).toBe(false);
		});

		it('returns false for empty names array without querying', async () => {
			const result = await areAnyCharacterNamesKnown('line-1', []);
			expect(result).toBe(false);
			expect(mockDb.select).not.toHaveBeenCalled();
		});

		it('returns true on a single alias match', async () => {
			mockDbSelectResults = [[{ found: 1 }]];
			const result = await areAnyCharacterNamesKnown('line-1', ['Shadow']);
			expect(result).toBe(true);
		});
	});

	describe('getMaxSceneNumberForActLine', () => {
		it('returns max scene number when profiles with scene numbers exist', async () => {
			mockDbSelectResults = [[{ max_scene: 10 }]];
			const result = await getMaxSceneNumberForActLine('line-1');
			expect(result).toBe(10);
		});

		it('returns null when no profiles exist', async () => {
			mockDbSelectResults = [[{ max_scene: null }]];
			const result = await getMaxSceneNumberForActLine('line-1');
			expect(result).toBeNull();
		});

		it('returns null when only baseline (null scene_number) profiles exist', async () => {
			mockDbSelectResults = [[{ max_scene: -1 }]];
			const result = await getMaxSceneNumberForActLine('line-1');
			expect(result).toBeNull();
		});

		it('returns null when no rows returned', async () => {
			mockDbSelectResults = [[]];
			const result = await getMaxSceneNumberForActLine('line-1');
			expect(result).toBeNull();
		});
	});

	describe('deleteCharacterProfilesForActLine', () => {
		it('calls execute with DELETE', async () => {
			await deleteCharacterProfilesForActLine('line-1');
			expect(mockDb.execute).toHaveBeenCalledTimes(1);
			expect(mockDb.execute.mock.calls[0][0]).toContain('DELETE FROM character_profiles');
			expect(mockDb.execute.mock.calls[0][1]).toEqual(['line-1']);
		});
	});

	describe('cloneCharacterProfiles', () => {
		it('clones all rows with new UUIDs and destination act line ID, preserving canonical_name', async () => {
			mockDbSelectResults = [
				[
					{
						id: 'p1',
						act_line_id: 'src',
						scene_number: 5,
						canonical_name: 'elena',
						preferred_name: 'Elena',
						aliases: '["E"]',
						logline: 'A hero.',
						state: 'P',
						goal: null,
						relationships: null,
						voice: null,
						scene_details: 'D',
						importance: 2,
						created_at: 1000,
						updated_at: 2000,
					},
					{
						id: 'p2',
						act_line_id: 'src',
						scene_number: null,
						canonical_name: 'voss',
						preferred_name: 'Voss',
						aliases: '[]',
						logline: 'A gruff captain.',
						state: 'P2',
						goal: null,
						relationships: null,
						voice: null,
						scene_details: '',
						importance: 4,
						created_at: 3000,
						updated_at: 3000,
					},
				],
			];

			await cloneCharacterProfiles('src', 'dest', 5);

			expect(mockDb.execute).toHaveBeenCalledTimes(2);
			const params1 = (mockDb.execute.mock.calls[0] as unknown as any[])[1];
			expect(params1[1]).toBe('dest');
			expect(params1[3]).toBe('elena');
			expect(params1[4]).toBe('Elena');
			expect(params1[0]).not.toBe('p1');
		});

		it('does nothing when source has no profiles', async () => {
			mockDbSelectResults = [[]];
			await cloneCharacterProfiles('src', 'dest', 5);
			expect(mockDb.execute).not.toHaveBeenCalled();
		});

		it('passes maxSceneNumber as second bind param', async () => {
			mockDbSelectResults = [[]];
			await cloneCharacterProfiles('src', 'dest', 7);
			expect(mockDb.select).toHaveBeenCalledTimes(1);
			const params = (mockDb.select.mock.calls[0] as unknown as any[])[1];
			expect(params).toEqual(['src', 7]);
		});

		it('includes baseline (NULL scene_number) and scene rows up to maxSceneNumber', async () => {
			const sceneRow = {
				id: 'p1',
				act_line_id: 'src',
				scene_number: 3,
				canonical_name: 'elena',
				preferred_name: 'Elena',
				aliases: '[]',
				logline: 'A hero.',
				state: 'P',
				goal: null,
				relationships: null,
				voice: null,
				scene_details: '',
				importance: 2,
				created_at: 1000,
				updated_at: 2000,
			};
			const baselineRow = {
				id: 'p2',
				act_line_id: 'src',
				scene_number: null,
				canonical_name: 'voss',
				preferred_name: 'Voss',
				aliases: '[]',
				logline: 'A gruff captain.',
				state: 'P2',
				goal: null,
				relationships: null,
				voice: null,
				scene_details: '',
				importance: 4,
				created_at: 3000,
				updated_at: 3000,
			};
			mockDbSelectResults = [[sceneRow, baselineRow]];

			await cloneCharacterProfiles('src', 'dest', 3);

			expect(mockDb.execute).toHaveBeenCalledTimes(2);
			const selectParams = (mockDb.select.mock.calls[0] as unknown as any[])[1];
			expect(selectParams).toEqual(['src', 3]);
		});
	});

	describe('inheritProfilesFromActLine', () => {
		it('writes baseline rows with canonical_name preserved and preferredName folded into aliases', async () => {
			mockDbSelectResults = [
				[
					{
						canonical_name: 'elena',
						preferred_name: 'Elena',
						aliases: '["Shadow"]',
						logline: 'A determined hero.',
						state: 'Determined',
						goal: null,
						relationships: null,
						voice: null,
						importance: 2,
					},
				],
			];

			await inheritProfilesFromActLine('src', 'dest');

			expect(mockDb.execute).toHaveBeenCalledTimes(1);
			const params = (mockDb.execute.mock.calls[0] as unknown as any[])[1];
			expect(params[1]).toBe('dest');
			expect(params[2]).toBeNull();
			expect(params[3]).toBe('elena');
			expect(params[4]).toBe('Elena');
			const aliases = JSON.parse(params[5] as string);
			expect(aliases).toContain('Shadow');
			expect(aliases).toContain('Elena');
		});

		it('deduplicates aliases when preferred name already in aliases', async () => {
			mockDbSelectResults = [
				[
					{
						canonical_name: 'elena',
						preferred_name: 'Elena',
						aliases: '["Elena","Shadow"]',
						logline: 'A hero.',
						state: 'P',
						goal: null,
						relationships: null,
						voice: null,
						importance: 1,
					},
				],
			];

			await inheritProfilesFromActLine('src', 'dest');

			const params = (mockDb.execute.mock.calls[0] as unknown as any[])[1];
			const aliases = JSON.parse(params[5] as string);
			expect(aliases.filter((a: string) => a === 'Elena')).toHaveLength(1);
		});

		it('does nothing when source has no profiles', async () => {
			mockDbSelectResults = [[]];
			await inheritProfilesFromActLine('src', 'dest');
			expect(mockDb.execute).not.toHaveBeenCalled();
		});
	});
});
