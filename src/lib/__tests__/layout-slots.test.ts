import { describe, it, expect, beforeAll } from 'vitest';
import {
	applyLayoutSlots,
	getProfileUpdateLabels,
	profileUpdateContract,
	profileUpdateRepairInstructions,
	type ProfileUpdateLabels,
} from '#lib/definitions/pipeline-prompts.ts';
import { ls, loadLocaleStrings } from '#lib/localization/index.ts';

// Mirrors how src/lib/fs/prompts.ts bundles the assets (eager ?raw glob): the
// test reads the exact text that ships, with no AppData or filesystem dependency.
const BUNDLED = import.meta.glob('../fs/*/prompts/summarizer/*.md', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

const FILES = ['summarizer-prompt', 'summarizer-incremental-prompt', 'character-profile-compressor'] as const;
const LOCALES = ['en', 'zh-Hant-HK'] as const;
type Locale = (typeof LOCALES)[number];
type FileName = (typeof FILES)[number];
type Mode = 'rich' | 'compact';

// Identifier mapping, independent of the implementation's LAYOUT_SLOT_KEYS.
// No prose here (D9): expected values are derived from the bundled files and ls().
const SLOTS = [
	{ placeholder: '{{layoutFullAnalyzeInputs}}', key: 'pipeline.layoutSlots.fullAnalyzeInputs' },
	{ placeholder: '{{layoutFullSceneSummaries}}', key: 'pipeline.layoutSlots.fullSceneSummaries' },
	{ placeholder: '{{layoutIncrementalAnalyzeInputs}}', key: 'pipeline.layoutSlots.incrementalAnalyzeInputs' },
	{ placeholder: '{{layoutIncrementalScope}}', key: 'pipeline.layoutSlots.incrementalScope' },
	{ placeholder: '{{layoutCompressorSources}}', key: 'pipeline.layoutSlots.compressorSources' },
] as const;

const FILE_SLOTS: Record<FileName, readonly string[]> = {
	'summarizer-prompt': ['{{layoutFullAnalyzeInputs}}', '{{layoutFullSceneSummaries}}'],
	'summarizer-incremental-prompt': ['{{layoutIncrementalAnalyzeInputs}}', '{{layoutIncrementalScope}}'],
	'character-profile-compressor': ['{{layoutCompressorSources}}'],
};

function bundled(locale: Locale, name: FileName): string {
	const text = BUNDLED[`../fs/${locale}/prompts/summarizer/${name}.md`];
	if (text === undefined) throw new Error(`missing bundled prompt: ${locale}/${name}`);
	return text;
}

function substitute(text: string, mode: Mode): string {
	let result = text;
	for (const { placeholder, key } of SLOTS) result = result.replaceAll(placeholder, ls(`${key}.${mode}`));
	return result;
}

function unsubstitute(text: string, mode: Mode): string {
	let result = text;
	for (const { placeholder, key } of SLOTS) result = result.replaceAll(ls(`${key}.${mode}`), placeholder);
	return result;
}

function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

for (const locale of LOCALES) {
	describe(`layout slots (${locale})`, () => {
		beforeAll(async () => {
			await loadLocaleStrings(locale);
		});

		it('every slot key resolves in this locale', () => {
			for (const { key } of SLOTS) {
				for (const mode of ['rich', 'compact'] as const) {
					const value = ls(`${key}.${mode}`);
					expect(value).not.toBe(`${key}.${mode}`);
					expect(value.length).toBeGreaterThan(0);
				}
			}
		});

		for (const name of FILES) {
			it(`${name}: placeholders placed exactly once, in order`, () => {
				const text = bundled(locale, name);
				const expected = FILE_SLOTS[name];
				let lastIndex = -1;
				for (const placeholder of expected) {
					expect(countOccurrences(text, placeholder)).toBe(1);
					const index = text.indexOf(placeholder);
					expect(index).toBeGreaterThan(lastIndex);
					lastIndex = index;
				}
				expect(countOccurrences(text, '{{layout')).toBe(expected.length);
			});

			for (const mode of ['rich', 'compact'] as const) {
				it(`${name}: ${mode} assembly follows the slot mapping, nothing unresolved`, () => {
					const text = bundled(locale, name);
					const assembled = applyLayoutSlots(text, mode);
					expect(assembled).toBe(substitute(text, mode));
					expect(assembled).not.toContain('{{layout');
				});

				it(`${name}: ${mode} assembly round-trips to the bundled file`, () => {
					const text = bundled(locale, name);
					expect(unsubstitute(applyLayoutSlots(text, mode), mode)).toBe(text);
				});
			}
		}
	});

	for (const locale of LOCALES) {
		describe(`profile update contracts (${locale})`, () => {
			beforeAll(async () => {
				await loadLocaleStrings(locale);
			});

			const allLabels = (labels: ProfileUpdateLabels) => [
				labels.envelope,
				labels.count,
				labels.clearFields,
				...Object.values(labels.fields),
			];

			it('structuredMarkdown contract resolves every captured label and excludes the tool transport', () => {
				const labels = getProfileUpdateLabels();
				const contract = profileUpdateContract('structuredMarkdown', labels);
				for (const label of allLabels(labels)) expect(contract).toContain(label);
				expect(contract).not.toContain('{{');
				expect(contract).not.toContain('update-character-profile');
			});

			it('toolCalls contract is a distinct resolved contract for the tool transport', () => {
				const labels = getProfileUpdateLabels();
				const markdown = profileUpdateContract('structuredMarkdown', labels);
				const toolCalls = profileUpdateContract('toolCalls', labels);
				expect(toolCalls).not.toBe(markdown);
				for (const label of allLabels(labels)) expect(toolCalls).toContain(label);
				expect(toolCalls).not.toContain('{{');
				expect(toolCalls).toContain('update-character-profile');
			});

			it('structuredMarkdown contract places scalars before collection sections', () => {
				const labels = getProfileUpdateLabels();
				const contract = profileUpdateContract('structuredMarkdown', labels);
				const order = [
					labels.envelope,
					labels.count,
					labels.fields.preferredName,
					labels.fields.logline,
					labels.fields.state,
					labels.fields.goal,
					labels.fields.relationships,
					labels.fields.voice,
					labels.fields.importance,
					labels.fields.aliases,
					labels.fields.traits,
					labels.clearFields,
				];
				let lastIndex = -1;
				for (const label of order) {
					const index = contract.indexOf(label);
					expect(index).toBeGreaterThan(lastIndex);
					lastIndex = index;
				}
			});

			it('repair instructions are resolved, complete and distinct from the transport contract', () => {
				const labels = getProfileUpdateLabels();
				const repair = profileUpdateRepairInstructions(labels);
				for (const label of allLabels(labels)) expect(repair).toContain(label);
				expect(repair).not.toContain('{{');
				expect(repair).not.toBe(profileUpdateContract('structuredMarkdown', labels));
			});
		});
	}
}
