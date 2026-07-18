import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/localization', () => ({
	ls: (key: string, _opts?: Record<string, unknown>) => {
		const levels: Record<string, string> = {
			'pipeline.labels.importanceLevels.1': 'Protagonist',
			'pipeline.labels.importanceLevels.2': 'Main',
			'pipeline.labels.importanceLevels.3': 'Supporting',
			'pipeline.labels.importanceLevels.4': 'Minor',
		};
		return levels[key] ?? key;
	},
}));

import {
	_parseCharacterJsonForTest as parseCharacterJson,
	_computeCardFilenameForTest as computeCardFilename,
	toCharacterEntries,
	toCharacterSummary,
	type CharacterSummary,
} from '$lib/features/character-card-generator';
import type { CharacterProfileEntity } from '$lib/db/character-profiles';

describe('parseCharacterJson', () => {
	it('parses simple JSON array', () => {
		const input = JSON.stringify([
			{ character: 'John Doe', importance: 'Protagonist' },
			{ character: 'Jane Smith', importance: 'Supporting role' },
		]);
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ character: 'John Doe', importance: 'Protagonist', canonicalName: 'john-doe' });
		expect(result[1]).toEqual({ character: 'Jane Smith', importance: 'Supporting role', canonicalName: 'jane-smith' });
	});

	it('strips markdown code fences', () => {
		const input = '```json\n' + JSON.stringify([{ character: 'Test', importance: 'Test role' }]) + '\n```';
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ character: 'Test', importance: 'Test role', canonicalName: 'test' });
	});

	it('strips plain code fences', () => {
		const input = '```\n' + JSON.stringify([{ character: 'Test', importance: 'Test role' }]) + '\n```';
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ character: 'Test', importance: 'Test role', canonicalName: 'test' });
	});

	it('handles whitespace around content', () => {
		const input = '  \n  ' + JSON.stringify([{ character: 'Test', importance: 'Role' }]) + '  \n  ';
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(1);
	});

	it('throws PARSE_FAILED for invalid JSON', () => {
		expect(() => parseCharacterJson('not valid json')).toThrow('PARSE_FAILED');
	});

	it('throws PARSE_FAILED for non-array JSON', () => {
		expect(() => parseCharacterJson('{"character": "Test"}')).toThrow('PARSE_FAILED');
	});

	it('throws PARSE_FAILED for empty string', () => {
		expect(() => parseCharacterJson('')).toThrow('PARSE_FAILED');
	});

	it('filters out non-object items', () => {
		const input = JSON.stringify([
			{ character: 'Valid', importance: 'Role' },
			'invalid string',
			123,
			null,
			{ character: 'Also Valid', importance: 'Another role' },
		]);
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(2);
		expect(result[0].character).toBe('Valid');
		expect(result[1].character).toBe('Also Valid');
	});

	it('filters out objects missing required fields', () => {
		const input = JSON.stringify([
			{ character: 'Has Name', importance: 'Role' },
			{ character: 'Missing Importance' },
			{ importance: 'Missing Name' },
			{ other: 'fields' },
		]);
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(1);
		expect(result[0].character).toBe('Has Name');
	});

	it('returns empty array for valid JSON with no matching objects', () => {
		const input = JSON.stringify([{ other: 'field' }, { name: 'Wrong field name' }]);
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(0);
	});

	it('handles empty array', () => {
		const input = JSON.stringify([]);
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(0);
	});

	it('handles complex importance descriptions', () => {
		const input = JSON.stringify([
			{
				character: 'Complex Character',
				importance: 'A very long description with many words and special chars: colon, "quotes", and more!',
			},
		]);
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(1);
		expect(result[0].importance).toContain('colon');
	});
});

describe('computeCardFilename', () => {
	it('returns canonical name with .md extension', () => {
		const result = computeCardFilename('john-doe');
		expect(result).toBe('john-doe.md');
	});

	it('handles complex canonical names', () => {
		const result = computeCardFilename('dr-john-the-doc-smith');
		expect(result).toBe('dr-john-the-doc-smith.md');
	});

	it('handles simple names', () => {
		const result = computeCardFilename('test');
		expect(result).toBe('test.md');
	});
});

describe('toCharacterEntries', () => {
	it('spreads summaries and sets include=true, isManual=false', () => {
		const summaries: CharacterSummary[] = [
			{ character: 'John Doe', importance: 'Protagonist', canonicalName: 'john-doe' },
			{ character: 'Jane Smith', importance: 'Supporting', canonicalName: 'jane-smith' },
		];
		const result = toCharacterEntries(summaries);

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			character: 'John Doe',
			importance: 'Protagonist',
			canonicalName: 'john-doe',
			include: true,
			isManual: false,
		});
		expect(result[1]).toEqual({
			character: 'Jane Smith',
			importance: 'Supporting',
			canonicalName: 'jane-smith',
			include: true,
			isManual: false,
		});
	});

	it('handles empty array', () => {
		const result = toCharacterEntries([]);
		expect(result).toHaveLength(0);
	});

	it('preserves canonicalName from summary (does not re-derive)', () => {
		const summaries: CharacterSummary[] = [
			{ character: 'Dr. John "The Doc" Smith', importance: 'Doctor', canonicalName: 'dr-john-the-doc-smith' },
		];
		const result = toCharacterEntries(summaries);
		expect(result[0].canonicalName).toBe('dr-john-the-doc-smith');
	});

	it('sets include to true and isManual to false for all entries', () => {
		const summaries: CharacterSummary[] = [
			{ character: 'A', importance: 'Role 1', canonicalName: 'a' },
			{ character: 'B', importance: 'Role 2', canonicalName: 'b' },
		];
		const result = toCharacterEntries(summaries);
		result.forEach((entry) => {
			expect(entry.include).toBe(true);
			expect(entry.isManual).toBe(false);
		});
	});
});

describe('toCharacterSummary', () => {
	it('maps preferredName, canonicalName, and labels importance with logline', () => {
		const profile: CharacterProfileEntity = {
			id: 'p1',
			actLineId: 'line-1',
			sceneNumber: null,
			canonicalName: 'elena',
			preferredName: 'Elena',
			aliases: [],
			logline: 'Hero of the story',
			state: null,
			goal: null,
			relationships: null,
			voice: null,
			sceneDetails: '',
			importance: 1,
			createdAt: 0,
			updatedAt: 0,
		};
		const result = toCharacterSummary(profile);
		expect(result.character).toBe('Elena');
		expect(result.canonicalName).toBe('elena');
		expect(result.importance).toBe('Protagonist: Hero of the story');
	});

	it('passes through canonicalName without re-deriving from preferredName', () => {
		const profile: CharacterProfileEntity = {
			id: 'p2',
			actLineId: 'line-1',
			sceneNumber: null,
			canonicalName: 'voss',
			preferredName: 'Dr. Voss',
			aliases: [],
			logline: 'Minor informant',
			state: null,
			goal: null,
			relationships: null,
			voice: null,
			sceneDetails: '',
			importance: 4,
			createdAt: 0,
			updatedAt: 0,
		};
		const result = toCharacterSummary(profile);
		expect(result.canonicalName).toBe('voss');
		expect(result.character).toBe('Dr. Voss');
		expect(result.importance).toBe('Minor: Minor informant');
	});
});
