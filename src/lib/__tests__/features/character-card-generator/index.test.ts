import { describe, it, expect } from 'vitest';
import {
	_parseCharacterJsonForTest as parseCharacterJson,
	_computeCardFilenameForTest as computeCardFilename,
	toCharacterEntries,
	type CharacterSummary,
} from '$lib/features/character-card-generator';

describe('parseCharacterJson', () => {
	it('parses simple JSON array', () => {
		const input = JSON.stringify([
			{ character: 'John Doe', importance: 'Protagonist' },
			{ character: 'Jane Smith', importance: 'Supporting role' },
		]);
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ character: 'John Doe', importance: 'Protagonist' });
		expect(result[1]).toEqual({ character: 'Jane Smith', importance: 'Supporting role' });
	});

	it('strips markdown code fences', () => {
		const input = '```json\n' + JSON.stringify([{ character: 'Test', importance: 'Test role' }]) + '\n```';
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ character: 'Test', importance: 'Test role' });
	});

	it('strips plain code fences', () => {
		const input = '```\n' + JSON.stringify([{ character: 'Test', importance: 'Test role' }]) + '\n```';
		const result = parseCharacterJson(input);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ character: 'Test', importance: 'Test role' });
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
	it('converts summaries to entries with auto-generated canonical names', () => {
		const summaries: CharacterSummary[] = [
			{ character: 'John Doe', importance: 'Protagonist' },
			{ character: 'Jane Smith', importance: 'Supporting' },
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

	it('correctly kebab-cases complex names', () => {
		const summaries: CharacterSummary[] = [{ character: 'Dr. John "The Doc" Smith', importance: 'Doctor' }];
		const result = toCharacterEntries(summaries);
		expect(result[0].canonicalName).toBe('dr-john-the-doc-smith');
	});

	it('sets include to true and isManual to false for all entries', () => {
		const summaries: CharacterSummary[] = [
			{ character: 'A', importance: 'Role 1' },
			{ character: 'B', importance: 'Role 2' },
		];
		const result = toCharacterEntries(summaries);
		result.forEach((entry) => {
			expect(entry.include).toBe(true);
			expect(entry.isManual).toBe(false);
		});
	});
});
