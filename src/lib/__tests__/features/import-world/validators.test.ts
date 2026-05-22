import { describe, it, expect } from 'vitest';
import { validateImportForm, hasRequiredActContent } from '../../../features/import-world/validators';
import type { ImportFormData, ImportActInput, ImportCharacterInput } from '../../../features/import-world/types';

function createFile(name: string): File {
	return new File(['content'], name, { type: 'text/plain' });
}

function createJsonFile(name: string): File {
	return new File(['{}'], name, { type: 'application/json' });
}

function makeAct(overrides: Partial<ImportActInput> = {}): ImportActInput {
	return {
		id: crypto.randomUUID(),
		name: '',
		actFile: null,
		transcript: null,
		...overrides,
	};
}

function makeCharacter(overrides: Partial<ImportCharacterInput> = {}): ImportCharacterInput {
	return {
		id: crypto.randomUUID(),
		name: '',
		cardFile: null,
		...overrides,
	};
}

function makeFormData(overrides: Partial<ImportFormData> = {}): ImportFormData {
	return {
		storyName: '',
		worldFile: null,
		acts: [],
		characters: [],
		skipOptionalMalformed: false,
		retryCount: 5,
		backoffIntervalSeconds: 5,
		...overrides,
	};
}

describe('validateImportForm', () => {
	describe('basic validation', () => {
		it('fails when no content is provided at all', () => {
			const result = validateImportForm(makeFormData());
			expect(result.isValid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].field).toBe('form');
		});

		it('passes with only a world file', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
				})
			);
			expect(result.isValid).toBe(true);
		});

		it('passes with only acts', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					acts: [makeAct({ actFile: createFile('act.md') })],
				})
			);
			expect(result.isValid).toBe(true);
		});

		it('passes with only characters', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					characters: [makeCharacter({ cardFile: createFile('char.md') })],
				})
			);
			expect(result.isValid).toBe(true);
		});
	});

	describe('act validation', () => {
		it('errors when single act has no content and no world file', () => {
			const result = validateImportForm(
				makeFormData({
					acts: [makeAct()],
				})
			);
			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.field.startsWith('act-'))).toBe(true);
		});

		it('passes when single act has no content but world file is present', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					acts: [makeAct()],
				})
			);
			expect(result.isValid).toBe(true);
		});

		it('errors when earlier acts lack transcripts', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					acts: [makeAct(), makeAct({ actFile: createFile('act2.md') })],
				})
			);
			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.message.includes('actTranscriptRequired'))).toBe(true);
		});

		it('passes when all acts except last have transcripts', () => {
			const result = validateImportForm(
				makeFormData({
					acts: [makeAct({ transcript: createJsonFile('t1.json') }), makeAct({ actFile: createFile('act2.md') })],
				})
			);
			expect(result.isValid).toBe(true);
		});

		it('validates act file type', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					acts: [makeAct({ actFile: createFile('act.pdf') })],
				})
			);
			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.message.includes('fileMustBeMdOrTxt'))).toBe(true);
		});

		it('validates transcript file type', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					acts: [makeAct({ transcript: createFile('transcript.txt') })],
				})
			);
			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.message.includes('fileMustBeJson'))).toBe(true);
		});

		it('accepts valid act file types', () => {
			const result = validateImportForm(
				makeFormData({
					acts: [makeAct({ actFile: createFile('act.md') })],
				})
			);
			expect(result.errors.some((e) => e.field.includes('file'))).toBe(false);
		});

		it('accepts valid transcript file types', () => {
			const result = validateImportForm(
				makeFormData({
					acts: [makeAct({ transcript: createJsonFile('transcript.json') })],
				})
			);
			expect(result.errors.some((e) => e.field.includes('transcript'))).toBe(false);
		});
	});

	describe('character validation', () => {
		it('warns but does not error when character card is missing', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					characters: [makeCharacter()],
				})
			);
			expect(result.isValid).toBe(true);
			expect(result.warnings.some((w) => w.message.includes('characterCardMissing'))).toBe(true);
		});

		it('passes when character card is provided', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					characters: [makeCharacter({ cardFile: createFile('char.md') })],
				})
			);
			expect(result.errors.some((e) => e.field.startsWith('character-'))).toBe(false);
		});

		it('validates character card file type', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					characters: [makeCharacter({ cardFile: createFile('char.pdf') })],
				})
			);
			expect(result.isValid).toBe(false);
			expect(result.errors.some((e) => e.message.includes('fileMustBeMdOrTxt'))).toBe(true);
		});
	});

	describe('warnings', () => {
		it('warns about missing story name', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
				})
			);
			expect(result.warnings.some((w) => w.field === 'storyName')).toBe(true);
		});

		it('does not warn when story name is provided', () => {
			const result = validateImportForm(
				makeFormData({
					storyName: 'My Story',
					worldFile: createFile('world.md'),
				})
			);
			expect(result.warnings.some((w) => w.field === 'storyName')).toBe(false);
		});

		it('warns about missing act names', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					acts: [makeAct({ actFile: createFile('act.md') })],
				})
			);
			expect(result.warnings.some((w) => w.field.includes('act-'))).toBe(true);
		});

		it('warns about missing character names', () => {
			const result = validateImportForm(
				makeFormData({
					worldFile: createFile('world.md'),
					characters: [makeCharacter({ cardFile: createFile('char.md') })],
				})
			);
			expect(result.warnings.some((w) => w.field.includes('character-'))).toBe(true);
		});
	});
});

describe('hasRequiredActContent', () => {
	it('returns true for last act with world file present', () => {
		expect(hasRequiredActContent(makeAct(), 0, 1, true, false)).toBe(true);
	});

	it('returns false for last act with no world file, no content, no characters', () => {
		expect(hasRequiredActContent(makeAct(), 0, 1, false, false)).toBe(false);
	});

	it('returns true for last act with act file', () => {
		expect(hasRequiredActContent(makeAct({ actFile: createFile('act.md') }), 0, 1, false, false)).toBe(true);
	});

	it('returns true for last act with transcript', () => {
		expect(hasRequiredActContent(makeAct({ transcript: createJsonFile('t.json') }), 0, 1, false, false)).toBe(true);
	});

	it('returns true for last act with character cards', () => {
		expect(hasRequiredActContent(makeAct(), 0, 1, false, true)).toBe(true);
	});

	it('returns false for non-last act without transcript', () => {
		expect(hasRequiredActContent(makeAct(), 0, 2, true, false)).toBe(false);
	});

	it('returns true for non-last act with transcript', () => {
		expect(hasRequiredActContent(makeAct({ transcript: createJsonFile('t.json') }), 0, 2, true, false)).toBe(true);
	});
});
