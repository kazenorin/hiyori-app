import { describe, it, expect } from 'vitest';
import { parseContent } from '$lib/utils/chat-stream-parser';
import type { OutputDescriptor } from '$lib/utils/chat-stream-parser';
import { get } from 'lodash-es';

describe('SKILL.md examples', () => {
	describe('Quick Start', () => {
		it('extracts analysis body, findings list, and labeled quality', () => {
			const llmOutput = `# Analysis
Some analysis text

## Key Findings
- First finding
- Second finding

## Rating
- Quality: High
- Confidence: Medium`;

			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'analysis', match: { type: 'header', content: 'Analysis' }, bodyOnly: true, currentLevelOnly: true },
				{
					outputPath: 'findings',
					match: { type: 'list', listIndex: 0, parent: { type: 'header', content: 'Key Findings' } },
					bodyOnly: true,
				},
				{
					outputPath: 'quality',
					match: { type: 'list_labeled_item', content: 'Quality', parent: { type: 'header', content: 'Rating' } },
					bodyOnly: true,
				},
			];

			const result = parseContent(llmOutput, descriptors);
			expect(result).toEqual({
				analysis: 'Some analysis text',
				findings: ['First finding', 'Second finding'],
				quality: 'High',
			});
		});
	});

	describe('Header extraction examples', () => {
		it('full section (header + body + sub-sections)', () => {
			const inputContent = '# Summary\nbody text\n## Sub\nmore';
			const descriptors: OutputDescriptor[] = [{ outputPath: 'section', match: { type: 'header', content: 'Summary' } }];
			const output = parseContent(inputContent, descriptors);
			expect(output.section).toBe('# Summary\nbody text\n## Sub\nmore');
		});

		it('body only (strips header line, includes sub-sections)', () => {
			const inputContent = '# Summary\nbody text\n## Sub\nmore';
			const descriptors: OutputDescriptor[] = [{ outputPath: 'body', match: { type: 'header', content: 'Summary' }, bodyOnly: true }];
			const output = parseContent(inputContent, descriptors);
			expect(output.body).toBe('body text\n## Sub\nmore');
		});

		it('current level only (header + own body, no sub-sections)', () => {
			const inputContent = '# Summary\nbody text\n## Sub\nmore';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'own', match: { type: 'header', content: 'Summary' }, currentLevelOnly: true },
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.own).toBe('# Summary\nbody text');
		});

		it('specific heading level', () => {
			const inputContent = '# Title\nh1 text\n### Title\nh3 text\n## Title\nh2 text';
			const descriptors: OutputDescriptor[] = [{ outputPath: 'h3', match: { type: 'header', content: 'Title', headerLevel: 3 } }];
			const output = parseContent(inputContent, descriptors);
			expect(output.h3).toBe('### Title\nh3 text');
		});

		it('parent filter', () => {
			const inputContent = '# Subject 1\n## Comments\nBeta\n# Subject 2\n## Comments\nEpsilon';
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'comment',
					match: { type: 'header', content: 'Comments', parent: { type: 'header', content: 'Subject 1' } },
					bodyOnly: true,
				},
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.comment).toBe('Beta');
		});

		it('ancestor filter', () => {
			const inputContent = '# Level 1\nlv1\n## Level 2\nlv2\n### Level 3\nlv3\n#### Level 4\nfinally!';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'descendant', match: { type: 'header', content: 'Level 4', ancestor: { type: 'header', content: 'Level 1' } } },
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.descendant).toBe('#### Level 4\nfinally!');
		});

		it('children with nested extraction', () => {
			const inputContent = '# Level 1\nl1 body\n## Level 2\nl2 body';
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'lv1',
					match: {
						type: 'header',
						content: 'Level 1',
						children: [{ outputPath: 'lv2', match: { type: 'header', content: 'Level 2' }, bodyOnly: true }],
					},
				},
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.lv1).toEqual({ lv2: 'l2 body' });
		});
	});

	describe('List extraction examples', () => {
		it('first list with markers', () => {
			const inputContent = '- item 1\n- item 2';
			const descriptors: OutputDescriptor[] = [{ outputPath: 'items', match: { type: 'list', listIndex: 0 } }];
			const output = parseContent(inputContent, descriptors);
			expect(output.items).toEqual(['- item 1', '- item 2']);
		});

		it('body only (strip markers)', () => {
			const inputContent = '- item 1\n- item 2';
			const descriptors: OutputDescriptor[] = [{ outputPath: 'items', match: { type: 'list', listIndex: 0 }, bodyOnly: true }];
			const output = parseContent(inputContent, descriptors);
			expect(output.items).toEqual(['item 1', 'item 2']);
		});

		it('body only, current level (nested sub-items excluded)', () => {
			const inputContent = '- item 1\n- item 2\n  - sub a\n  - sub b\n- item 3';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'items', match: { type: 'list', listIndex: 0 }, bodyOnly: true, currentLevelOnly: true },
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.items).toEqual(['item 1', 'item 2', 'item 3']);
		});

		it('second list in a section', () => {
			const inputContent = '# Section\nList 1:\n- a\n- b\n\nList 2:\n- c\n- d';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'items', match: { type: 'list', listIndex: 1, parent: { type: 'header', content: 'Section' } }, bodyOnly: true },
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.items).toEqual(['c', 'd']);
		});
	});

	describe('List item extraction examples', () => {
		it('with marker', () => {
			const inputContent = '- item 1\n- item 2';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'first', match: { type: 'list_item', itemIndex: 0, parent: { type: 'list', listIndex: 0 } } },
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.first).toBe('- item 1');
		});

		it('body only', () => {
			const inputContent = '- item 1\n- item 2';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'first', match: { type: 'list_item', itemIndex: 0, parent: { type: 'list', listIndex: 0 } }, bodyOnly: true },
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.first).toBe('item 1');
		});

		it('within a header section', () => {
			const inputContent = '# Shopping\n- apples\n- bread\n- cheese';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'item', match: { type: 'list_item', itemIndex: 1, parent: { type: 'header', content: 'Shopping' } }, bodyOnly: true },
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.item).toBe('bread');
		});
	});

	describe('Labeled list item extraction examples', () => {
		it('body only (value after colon)', () => {
			const inputContent = '- Quality: High\n- Confidence: Medium';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'score', match: { type: 'list_labeled_item', content: 'Quality' }, bodyOnly: true },
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.score).toBe('High');
		});

		it('full raw text', () => {
			const inputContent = '- Quality: High\n- Confidence: Medium';
			const descriptors: OutputDescriptor[] = [{ outputPath: 'raw', match: { type: 'list_labeled_item', content: 'Quality' } }];
			const output = parseContent(inputContent, descriptors);
			expect(output.raw).toBe('- Quality: High');
		});

		it('scoped to a header', () => {
			const inputContent = '# Section A\n- Key: Value A\n\n# Section B\n- Key: Value B';
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'key',
					match: { type: 'list_labeled_item', content: 'Key', parent: { type: 'header', content: 'Section A' } },
					bodyOnly: true,
				},
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.key).toBe('Value A');
		});

		it('from the second list', () => {
			const inputContent = '- Name: Alice\n\nSome text\n\n- Name: Bob';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'name', match: { type: 'list_labeled_item', content: 'Name', listIndex: 1 }, bodyOnly: true },
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.name).toBe('Bob');
		});
	});

	describe('Key behaviors', () => {
		it('dot-notation outputPath', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'meta.scores.quality', match: { type: 'header', content: 'Score' }, bodyOnly: true },
			];
			const inputContent = '# Score\n95';
			const output = parseContent(inputContent, descriptors);
			expect(get(output, 'meta.scores.quality')).toBe('95');
		});

		it('pre-populated output object', () => {
			interface MyOutput {
				fieldOne: string;
				fieldTwo: { inner: string };
			}
			const output: MyOutput = { fieldOne: '', fieldTwo: { inner: '' } };
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'fieldOne', match: { type: 'header', content: 'Alpha' }, bodyOnly: true },
				{ outputPath: 'fieldTwo.inner', match: { type: 'header', content: 'Beta' }, bodyOnly: true },
			];
			const result = parseContent('# Alpha\na1\n# Beta\nb2', descriptors, output);
			expect(result.fieldOne).toBe('a1');
			expect(result.fieldTwo.inner).toBe('b2');
		});

		it('unmatched header returns null', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'result', match: { type: 'header', content: 'NonExistent' } }];
			const output = parseContent('# Something\nelse', descriptors);
			expect(output.result).toBeNull();
		});

		it('unmatched list returns empty array', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'result', match: { type: 'list', listIndex: 0 } }];
			const output = parseContent('no lists here', descriptors);
			expect(output.result).toEqual([]);
		});

		it('unmatched labeled item returns null', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'result', match: { type: 'list_labeled_item', content: 'Missing' }, bodyOnly: true },
			];
			const output = parseContent('- Name: Alice', descriptors);
			expect(output.result).toBeNull();
		});
	});
});

describe('patterns.md examples', () => {
	it('Key-Value Summary', () => {
		const inputContent = `## Summary
- Title: The Adventure Begins
- Genre: Fantasy
- Tone: Light-hearted`;

		const descriptors: OutputDescriptor[] = [
			{
				outputPath: 'title',
				match: { type: 'list_labeled_item', content: 'Title', parent: { type: 'header', content: 'Summary' } },
				bodyOnly: true,
			},
			{
				outputPath: 'genre',
				match: { type: 'list_labeled_item', content: 'Genre', parent: { type: 'header', content: 'Summary' } },
				bodyOnly: true,
			},
			{
				outputPath: 'tone',
				match: { type: 'list_labeled_item', content: 'Tone', parent: { type: 'header', content: 'Summary' } },
				bodyOnly: true,
			},
		];

		const output = parseContent(inputContent, descriptors);
		expect(output).toEqual({
			title: 'The Adventure Begins',
			genre: 'Fantasy',
			tone: 'Light-hearted',
		});
	});

	it('Item List', () => {
		const inputContent = `## Items
- Sword of Light
- Shield of Ages
- Map of Eldoria`;

		const descriptors: OutputDescriptor[] = [
			{ outputPath: 'items', match: { type: 'list', listIndex: 0, parent: { type: 'header', content: 'Items' } }, bodyOnly: true },
		];

		const output = parseContent(inputContent, descriptors);
		expect(output.items).toEqual(['Sword of Light', 'Shield of Ages', 'Map of Eldoria']);
	});

	it('Nested Sections', () => {
		const inputContent = `## Aria
- Role: Protagonist
- Motivation: Find the lost city

## Kael
- Role: Antagonist
- Motivation: Harness the ancient power`;

		const descriptors: OutputDescriptor[] = [
			{
				outputPath: 'aria',
				match: {
					type: 'header',
					content: 'Aria',
					children: [
						{ outputPath: 'role', match: { type: 'list_labeled_item', content: 'Role' }, bodyOnly: true },
						{ outputPath: 'motivation', match: { type: 'list_labeled_item', content: 'Motivation' }, bodyOnly: true },
					],
				},
			},
			{
				outputPath: 'kael',
				match: {
					type: 'header',
					content: 'Kael',
					children: [
						{ outputPath: 'role', match: { type: 'list_labeled_item', content: 'Role' }, bodyOnly: true },
						{ outputPath: 'motivation', match: { type: 'list_labeled_item', content: 'Motivation' }, bodyOnly: true },
					],
				},
			},
		];

		const output = parseContent(inputContent, descriptors);
		expect(output).toEqual({
			aria: { role: 'Protagonist', motivation: 'Find the lost city' },
			kael: { role: 'Antagonist', motivation: 'Harness the ancient power' },
		});
	});

	it('Same Header Name in Different Sections', () => {
		const inputContent = `# Subject 1
## Contents
Alpha
## Comments
Beta
# Subject 2
## Contents
Delta
## Comments
Epsilon`;

		const descriptors: OutputDescriptor[] = [
			{
				outputPath: 'comment1',
				match: { type: 'header', content: 'Comments', parent: { type: 'header', content: 'Subject 1' } },
				bodyOnly: true,
			},
			{
				outputPath: 'comment2',
				match: { type: 'header', content: 'Comments', parent: { type: 'header', content: 'Subject 2' } },
				bodyOnly: true,
			},
		];

		const output = parseContent(inputContent, descriptors);
		expect(output).toEqual({ comment1: 'Beta', comment2: 'Epsilon' });
	});

	it('Decision List with Labels', () => {
		const inputContent = `## Decisions
1. Action: Attack the guard
2. Consequence: Alert triggered
3. Outcome: Escape through window`;

		const descriptors: OutputDescriptor[] = [
			{
				outputPath: 'action',
				match: { type: 'list_labeled_item', content: 'Action', parent: { type: 'header', content: 'Decisions' } },
				bodyOnly: true,
			},
			{
				outputPath: 'consequence',
				match: { type: 'list_labeled_item', content: 'Consequence', parent: { type: 'header', content: 'Decisions' } },
				bodyOnly: true,
			},
			{
				outputPath: 'outcome',
				match: { type: 'list_labeled_item', content: 'Outcome', parent: { type: 'header', content: 'Decisions' } },
				bodyOnly: true,
			},
		];

		const output = parseContent(inputContent, descriptors);
		expect(output).toEqual({
			action: 'Attack the guard',
			consequence: 'Alert triggered',
			outcome: 'Escape through window',
		});
	});

	it('Flat Key-Value Across Multiple Lists', () => {
		const inputContent = `- Name: Alice
- Age: 30

Some text between lists

- Name: Bob
- Age: 25`;

		const descriptors: OutputDescriptor[] = [
			{ outputPath: 'firstAge', match: { type: 'list_labeled_item', content: 'Age', listIndex: 0 }, bodyOnly: true },
			{ outputPath: 'secondName', match: { type: 'list_labeled_item', content: 'Name', listIndex: 1 }, bodyOnly: true },
		];

		const output = parseContent(inputContent, descriptors);
		expect(output).toEqual({ firstAge: '30', secondName: 'Bob' });
	});

	it('Recursive Nested Extraction', () => {
		const inputContent = `# Act 1
## Scene 1
### Dialogue
Hello world
### Action
They fought`;

		const descriptors: OutputDescriptor[] = [
			{
				outputPath: 'act1',
				match: {
					type: 'header',
					content: 'Act 1',
					children: [
						{
							outputPath: 'scene1',
							match: {
								type: 'header',
								content: 'Scene 1',
								children: [
									{ outputPath: 'dialogue', match: { type: 'header', content: 'Dialogue' }, bodyOnly: true },
									{ outputPath: 'action', match: { type: 'header', content: 'Action' }, bodyOnly: true },
								],
							},
						},
					],
				},
			},
		];

		const output = parseContent(inputContent, descriptors);
		expect(output).toEqual({
			act1: { scene1: { dialogue: 'Hello world', action: 'They fought' } },
		});
	});
});
