import { describe, it, expect } from 'vitest';
import { parseContent } from '$lib/utils/chat-stream-parser';
import type { OutputDescriptor } from '$lib/utils/chat-stream-parser';

describe('parseContent', () => {
	describe('default behavior', () => {
		it('defaults output to full content when no descriptors provided', () => {
			const output = parseContent('hello');
			expect(output).toEqual({ output: 'hello' });
		});

		it('assigns full content to outputPath when match is omitted', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'output' }];
			const output = parseContent('text\nmore text', descriptors);

			expect(output).toHaveProperty('output', 'text\nmore text');
		});

		it('supports dot-notation outputPath', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'path.to.key.here' }];
			const output = parseContent('some content', descriptors);

			expect(output).toHaveProperty('path.to.key.here', 'some content');
		});

		it('assigns full content to multiple outputPaths', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'output1' }, { outputPath: 'output2' }];
			const output = parseContent('text\nmore text', descriptors);

			expect(output).toHaveProperty('output1', 'text\nmore text');
			expect(output).toHaveProperty('output2', 'text\nmore text');
		});

		it('parses with definition and output object schema', () => {
			interface NestedLevelOne {
				innerField: string;
			}
			interface MyOutput {
				fieldOne: string;
				fieldTwo: NestedLevelOne;
			}

			const output: MyOutput = { fieldOne: '', fieldTwo: { innerField: '' } };

			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'fieldOne', match: { type: 'header', content: 'Alpha' }, bodyOnly: true },
				{ outputPath: 'fieldTwo.innerField', match: { type: 'header', content: 'Beta' }, bodyOnly: false },
			];

			const result = parseContent('# Alpha\na1\n# Beta\nb2', descriptors, output);
			expect(result.fieldOne).toBe('a1');
			expect(result.fieldTwo.innerField).toBe('# Beta\nb2');
		});
	});

	describe('header extraction', () => {
		it('extracts header section with header line and body', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'output', match: { type: 'header', content: 'News' } },
				{ outputPath: 'someOtherKey', match: { type: 'header', content: 'Olds' } },
			];
			const output = parseContent('text\n# News\nnews body\n# Olds\nolds body', descriptors);

			expect(output).toHaveProperty('output', '# News\nnews body');
			expect(output).toHaveProperty('someOtherKey', '# Olds\nolds body');
		});

		it('unmatched header returns null', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'output', match: { type: 'header', content: 'news' } }];
			const output = parseContent('text\n# Olds\nolds body', descriptors);

			expect(output).toHaveProperty('output', null);
		});

		it('returns null when headerLevel does not match', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'result', match: { type: 'header', content: 'Alpha', headerLevel: 3 } }];
			const output = parseContent('# Alpha\na1', descriptors);
			expect(output.result).toBeNull();
		});

		it('returns null when parent filter excludes header', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'result', match: { type: 'header', content: 'Orphan', parent: { type: 'header', content: 'Parent A' } } },
			];
			const inputContent = '# Parent A\n## Child\n# Parent B\n## Orphan';
			const output = parseContent(inputContent, descriptors);
			expect(output.result).toBeNull();
		});

		it('returns match when ancestor filter includes header across HR', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'result', match: { type: 'header', content: 'Level 4', ancestor: { type: 'header', content: 'Level 1' } } },
			];
			const inputContent = `# Level 1
lv1

---

#### Level 4
lv4`;
			const output = parseContent(inputContent, descriptors);
			expect(output.result).toBe('#### Level 4\nlv4');
		});

		it('parses with header body only', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'output', match: { type: 'header', content: 'News' }, bodyOnly: true },
				{ outputPath: 'someOtherKey', match: { type: 'header', content: 'Olds' } },
			];
			const output = parseContent('text\n# News\nnews body\n# Olds\nolds body', descriptors);

			expect(output).toHaveProperty('output', 'news body');
			expect(output).toHaveProperty('someOtherKey', '# Olds\nolds body');
		});

		it('parses with header current level only', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'output', match: { type: 'header', content: 'Level 2' }, currentLevelOnly: true },
			];
			const inputContent = '# Level 1\nlv1\n## Level 2\nlv2\n### Level 3\nlv3\n';
			const output = parseContent(inputContent, descriptors);

			expect(output).toHaveProperty('output', '## Level 2\nlv2');
		});

		it('parses with header current level only and body only', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'output', match: { type: 'header', content: 'Level 2' }, currentLevelOnly: true, bodyOnly: true },
			];
			const inputContent = '# Level 1\nlv1\n## Level 2\nlv2\n### Level 3\nlv3\n';
			const output = parseContent(inputContent, descriptors);

			expect(output).toHaveProperty('output', 'lv2');
		});

		it('extracts child header using parent filter', () => {
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'mySubHeader',
					match: { type: 'header', content: 'Level 2', parent: { type: 'header', content: 'Level 1' } },
				},
			];
			const output = parseContent('text\n# Level 1\nnl1 body\n## Level 2\nl2 body\n### Level 3\nlv3 body', descriptors);

			expect(output).toHaveProperty('mySubHeader', '## Level 2\nl2 body\n### Level 3\nlv3 body');
		});

		it('extracts child header with nested children descriptors', () => {
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'mySubHeader',
					match: {
						type: 'header',
						content: 'Level 2',
						parent: { type: 'header', content: 'Level 1' },
						children: [{ outputPath: 'myChild', match: { type: 'header', content: 'Level 3' } }],
					},
				},
			];
			const output = parseContent('text\n# Level 1\nnl1 body\n## Level 2\nl2 body\n### Level 3\nlv3 body', descriptors);
			expect(output).toHaveProperty('mySubHeader');

			const mySubHeader = output.mySubHeader;
			expect(mySubHeader).toHaveProperty('myChild', '### Level 3\nlv3 body');
		});

		it('extracts deeply nested children at multiple levels', () => {
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'lv1',
					match: {
						type: 'header',
						content: 'Level 1',
						children: [
							{
								outputPath: 'lv2',
								match: {
									type: 'header',
									content: 'Level 2',
									children: [{ outputPath: 'lv3', match: { type: 'header', content: 'Level 3' }, bodyOnly: true }],
								},
							},
						],
					},
				},
			];

			type OutputType = { lv1: { lv2: { lv3: string } } };
			const inputContent = 'text\n# Level 1\nnl1 body\n## Level 2\nl2 body\n### Level 3\nlv3 body';
			const output = parseContent<OutputType>(inputContent, descriptors);
			expect(output.lv1.lv2.lv3).toBe('lv3 body');
		});

		it('extracts descendant header using ancestor filter', () => {
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'descendant',
					match: { type: 'header', content: 'Level 4', ancestor: { type: 'header', content: 'Level 2' } },
				},
			];
			const inputContent = '# Level 1\nlv1\n## Level 2\nlv2\n### Level 3\nlv3\n#### Level 4\nfinally!';

			const output = parseContent(inputContent, descriptors);

			expect(output).toHaveProperty('descendant', '#### Level 4\nfinally!');
		});

		it('parses specific heading level', () => {
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'result',
					match: { type: 'header', content: 'Head', headerLevel: 3 },
				},
			];
			const inputContent = '# Head\nAlpha\n## Head\nBeta\n### Head\nCharlie\n#### Head\nDelta\n';

			const output = parseContent(inputContent, descriptors);

			expect(output).toHaveProperty('result', '### Head\nCharlie\n#### Head\nDelta');
		});

		it('parses specific heading level with currentLevelOnly', () => {
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'result',
					currentLevelOnly: true,
					match: { type: 'header', content: 'Head', headerLevel: 3 },
				},
			];
			const inputContent = '# Head\nAlpha\n## Head\nBeta\n### Head\nCharlie\n#### Head\nDelta\n';

			const output = parseContent(inputContent, descriptors);

			expect(output).toHaveProperty('result', '### Head\nCharlie');
		});

		it('parses with multiple heading trees', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'comment1', match: { type: 'header', content: 'Comments', parent: { type: 'header', content: 'Subject 1' } } },
				{ outputPath: 'comment2', match: { type: 'header', content: 'Comments', parent: { type: 'header', content: 'Subject 2' } } },
			];
			const inputContent = `# Subject 1
## Contents
Alpha
## Comments
Beta
### Notes
Charlie
# Subject 2
## Contents
Delta
## Comments
Epsilon
### Notes
Foxtrot
`;

			const output = parseContent(inputContent, descriptors);

			expect(output).toHaveProperty('comment1', '## Comments\nBeta\n### Notes\nCharlie');
			expect(output).toHaveProperty('comment2', '## Comments\nEpsilon\n### Notes\nFoxtrot');
		});

		it('returns empty string for bodyOnly header with no body', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'output', match: { type: 'header', content: 'Solo' }, bodyOnly: true }];
			const output = parseContent('# Solo', descriptors);
			expect(output.output).toBe('');
		});

		it('returns header markdown for header with no body', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'output', match: { type: 'header', content: 'Solo' } }];
			const output = parseContent('# Solo', descriptors);
			expect(output.output).toBe('# Solo');
		});

		it('parses deeply nested headers', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'lv5', match: { type: 'header', content: 'Level 5', parent: { type: 'header', content: 'Level 3' } } },
			];
			const inputContent = '# Level 1\nlv1\n## Level 2\nlv2\n### Level 3\nlv3\n#### Level 4\nlv4\n##### Level 5\nlv5';
			const output = parseContent(inputContent, descriptors);
			expect(output.lv5).toBe('##### Level 5\nlv5');
		});

		it('parses deeply nested headers with currentLevelOnly', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'lv3', match: { type: 'header', content: 'Level 3' }, currentLevelOnly: true },
			];
			const inputContent = '# Level 1\nlv1\n## Level 2\nlv2\n### Level 3\nlv3\n#### Level 4\nlv4\n##### Level 5\nlv5';
			const output = parseContent(inputContent, descriptors);
			expect(output.lv3).toBe('### Level 3\nlv3');
		});

		it('parses children with bodyOnly on parent', () => {
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'lv1',
					bodyOnly: true,
					match: {
						type: 'header',
						content: 'Level 1',
						children: [{ outputPath: 'lv2', match: { type: 'header', content: 'Level 2' }, bodyOnly: true }],
					},
				},
			];
			const inputContent = '# Level 1\nlv1 body\n## Level 2\nlv2 body';
			const output = parseContent(inputContent, descriptors);
			expect(output.lv1).toHaveProperty('lv2', 'lv2 body');
		});

		it('parses children with currentLevelOnly on parent', () => {
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'lv1',
					currentLevelOnly: true,
					match: { type: 'header', content: 'Level 1', children: [{ outputPath: 'lv2', match: { type: 'header', content: 'Level 2' } }] },
				},
			];
			const inputContent = '# Level 1\nlv1 body\n## Level 2\nlv2 body';
			const output = parseContent(inputContent, descriptors);
			expect(output.lv1).toHaveProperty('lv2', null);
		});

		it('returns header text when selfContentOnly is true', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'dogs', match: { type: 'header', headerLevel: 2 }, selfContentOnly: true },
				{ outputPath: 'terriers', match: { type: 'header', headerLevel: 3 }, selfContentOnly: true },
			];
			const inputContent = `# Pets
## Dogs
### Terriers
Silky Terrier
`;

			const output = parseContent(inputContent, descriptors);

			expect(output).toHaveProperty('dogs', 'Dogs');
			expect(output).toHaveProperty('terriers', 'Terriers');
		});

		it('parses with selfContentOnly overrides bodyOnly', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'dogs', match: { type: 'header', headerLevel: 2 }, selfContentOnly: true, bodyOnly: true },
				{ outputPath: 'terriers', match: { type: 'header', headerLevel: 3 }, selfContentOnly: true, bodyOnly: true },
			];
			const inputContent = `# Pets
## Dogs
### Terriers
Silky Terrier
`;

			const output = parseContent(inputContent, descriptors);

			expect(output).toHaveProperty('dogs', 'Dogs');
			expect(output).toHaveProperty('terriers', 'Terriers');
		});
	});

	describe('multi-headers extraction', () => {
		describe('basic behaviour', () => {
			it('collects all headers at specified level across groups into array', () => {
				const descriptors: OutputDescriptor[] = [{ outputPath: 'lv2', match: { type: 'multi-headers', headerLevel: 2 } }];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
## Lighter blue
rgb(32,32,255)
# Pets
## Dogs
Silky Terrier
## Cats
Ragdoll
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.lv2).toEqual([
					'## Blue\nrgb(0,0,255)',
					'## Lighter blue\nrgb(32,32,255)',
					'## Dogs\nSilky Terrier',
					'## Cats\nRagdoll',
				]);
			});

			it('multi-headers omitting headerLevel assumes level 1', () => {
				const descriptors: OutputDescriptor[] = [{ outputPath: 'lv1', match: { type: 'multi-headers' } }];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
## Lighter blue
rgb(32,32,255)
# Pets
## Dogs
Silky Terrier
## Cats
Ragdoll
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.lv1).toEqual([
					'# Colors\n## Blue\nrgb(0,0,255)\n## Lighter blue\nrgb(32,32,255)',
					'# Pets\n## Dogs\nSilky Terrier\n## Cats\nRagdoll',
				]);
			});
		});

		describe('content selection', () => {
			it('returns body content for each matched section with bodyOnly', () => {
				const descriptors: OutputDescriptor[] = [{ outputPath: 'lv2', match: { type: 'multi-headers', headerLevel: 2 }, bodyOnly: true }];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
## Lighter blue
rgb(32,32,255)
# Pets
## Dogs
Silky Terrier
## Cats
Ragdoll
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.lv2).toEqual(['rgb(0,0,255)', 'rgb(32,32,255)', 'Silky Terrier', 'Ragdoll']);
			});

			it('returns header texts for each matched section with selfContentOnly', () => {
				const descriptors: OutputDescriptor[] = [
					{ outputPath: 'lv2', match: { type: 'multi-headers', headerLevel: 2 }, selfContentOnly: true },
				];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
## Lighter blue
rgb(32,32,255)
# Pets
## Dogs
Silky Terrier
## Cats
Ragdoll
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.lv2).toEqual(['Blue', 'Lighter blue', 'Dogs', 'Cats']);
			});

			it('selfContentOnly overrides bodyOnly', () => {
				const descriptors: OutputDescriptor[] = [
					{ outputPath: 'lv2', match: { type: 'multi-headers', headerLevel: 2 }, selfContentOnly: true, bodyOnly: true },
				];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
## Lighter blue
rgb(32,32,255)
# Pets
## Dogs
Silky Terrier
## Cats
Ragdoll
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.lv2).toEqual(['Blue', 'Lighter blue', 'Dogs', 'Cats']);
			});
		});

		describe('with parent matching', () => {
			it('filters multi-headers by header parent', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'colors',
						match: { type: 'multi-headers', headerLevel: 2, parent: { type: 'header', content: 'Colors' } },
						selfContentOnly: true,
					},
					{
						outputPath: 'pets',
						match: { type: 'multi-headers', headerLevel: 2, parent: { type: 'header', content: 'Pets' } },
						bodyOnly: true,
					},
				];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
## Lighter blue
rgb(32,32,255)
# Pets
## Dogs
Silky Terrier
## Cats
Ragdoll
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.colors).toEqual(['Blue', 'Lighter blue']);
				expect(output.pets).toEqual(['Silky Terrier', 'Ragdoll']);
			});

			it('only includes direct children when parent has nested sub-headers', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'colors',
						match: { type: 'multi-headers', headerLevel: 2, parent: { type: 'header', content: 'Colors' } },
						selfContentOnly: true,
					},
					{
						outputPath: 'pets',
						match: { type: 'multi-headers', headerLevel: 2, parent: { type: 'header', content: 'Pets' } },
						selfContentOnly: true,
					},
				];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
### Lighter blue
rgb(32,32,255)
# Pets
## Dogs
### Terriers
Silky Terrier
## Cats
Ragdoll
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.colors).toEqual(['Blue']);
				expect(output.pets).toEqual(['Dogs', 'Cats']);
			});
		});

		describe('as parent', () => {
			it('produces Record keyed by header text when multi-headers is parent of header match', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'colors',
						match: {
							type: 'header',
							headerLevel: 3,
							parent: { type: 'multi-headers', headerLevel: 2, parent: { type: 'header', content: 'Colors' } },
						},
					},
				];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
### Lighter blue
- rgb(32,32,255)
- rgb(64,64,255)
## Red
rgb(255,0,0)
### Lighter red
- rgb(255,32,32)
- rgb(255,64,64)
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.colors).toEqual({
					Blue: '### Lighter blue\n- rgb(32,32,255)\n- rgb(64,64,255)',
					Red: '### Lighter red\n- rgb(255,32,32)\n- rgb(255,64,64)',
				});
			});

			it('produces Record with bodyOnly applied to each child section', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'colors',
						match: {
							type: 'header',
							headerLevel: 3,
							parent: { type: 'multi-headers', headerLevel: 2, parent: { type: 'header', content: 'Colors' } },
						},
						bodyOnly: true,
					},
				];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
### Lighter blue
- rgb(32,32,255)
- rgb(64,64,255)
## Red
rgb(255,0,0)
### Lighter red
- rgb(255,32,32)
- rgb(255,64,64)
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.colors).toEqual({
					Blue: '- rgb(32,32,255)\n- rgb(64,64,255)',
					Red: '- rgb(255,32,32)\n- rgb(255,64,64)',
				});
			});

			it('produces Record with selfContentOnly applied to each child header', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'colors',
						match: {
							type: 'header',
							headerLevel: 3,
							parent: { type: 'multi-headers', headerLevel: 2, parent: { type: 'header', content: 'Colors' } },
						},
						selfContentOnly: true,
					},
				];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
### Lighter blue
- rgb(32,32,255)
- rgb(64,64,255)
## Red
rgb(255,0,0)
### Lighter red
- rgb(255,32,32)
- rgb(255,64,64)
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.colors).toEqual({
					Blue: 'Lighter blue',
					Red: 'Lighter red',
				});
			});

			it('produces Record keyed by header text when multi-headers is parent of list match', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'colors',
						match: { type: 'list', parent: { type: 'multi-headers', headerLevel: 3, ancestor: { type: 'header', content: 'Colors' } } },
						bodyOnly: true,
					},
				];
				const inputContent = `# Colors
## Blue
rgb(0,0,255)
### Lighter blue
- rgb(32,32,255)
- rgb(64,64,255)
## Red
rgb(255,0,0)
### Lighter red
- rgb(255,32,32)
- rgb(255,64,64)
`;
				const output = parseContent(inputContent, descriptors);
				expect(output.colors).toEqual({
					'Lighter blue': ['rgb(32,32,255)', 'rgb(64,64,255)'],
					'Lighter red': ['rgb(255,32,32)', 'rgb(255,64,64)'],
				});
			});
		});

		describe('as child', () => {
			it('extracts multi-headers within a header children array', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'colors',
						match: {
							type: 'header',
							content: 'Colors',
							children: [{ outputPath: 'color', match: { type: 'multi-headers', headerLevel: 2 } }],
						},
					},
				];
				const inputContent = `# Colors
## Red
rgb(255,0,0)
## Green
rgb(0,255,0)
## Blue
rgb(0,0,255)
`;
				type OutputType = { colors: { color: string[] } };
				const output = parseContent<OutputType>(inputContent, descriptors);
				expect(output.colors.color).toEqual(['## Red\nrgb(255,0,0)', '## Green\nrgb(0,255,0)', '## Blue\nrgb(0,0,255)']);
			});

			it('uses multi-headers as both child and parent in nested descriptors', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'pets',
						match: {
							type: 'header',
							content: 'Pets',
							children: [
								{
									outputPath: 'breeds',
									match: {
										type: 'header',
										headerLevel: 4,
										parent: { type: 'multi-headers', headerLevel: 3, parent: { type: 'header', content: 'Dogs' } },
									},
								},
							],
						},
					},
				];
				const inputContent = `# Pets
## Dogs
### Terriers
#### Silky terrier
cute
### Labradors
#### Labrador retriever
chill
### Collies
#### Border collies
cool
`;
				type OutputType = { pets: { breeds: Record<'Terriers' | 'Labradors' | 'Collies', string> } };
				const output = parseContent<OutputType>(inputContent, descriptors);
				expect(output.pets.breeds).toHaveProperty('Terriers', '#### Silky terrier\ncute');
				expect(output.pets.breeds).toHaveProperty('Labradors', '#### Labrador retriever\nchill');
				expect(output.pets.breeds).toHaveProperty('Collies', '#### Border collies\ncool');
			});
		});
	});

	describe('list extraction', () => {
		it('extracts unordered list items with markers', () => {
			const inputContent = 'My list:\n - item 1\n - item 2\n - item 3';
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'myList',
					match: { type: 'list', listIndex: 0 },
				},
			];

			const output = parseContent(inputContent, descriptors);
			expect(output.myList).toEqual([' - item 1', ' - item 2', ' - item 3']);
		});

		it('parses with ordered lists', () => {
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'myList',
					match: { type: 'list', listIndex: 0 },
				},
			];

			const inputContent = 'My list:\n1. item 1\n2. item 2\n3. item 3';
			const output = parseContent(inputContent, descriptors);
			expect(output.myList).toEqual(['1. item 1', '2. item 2', '3. item 3']);
		});

		it('parses with ordered lists body only', () => {
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'myList',
					bodyOnly: true,
					match: { type: 'list', listIndex: 0 },
				},
			];

			const inputContent = 'My list:\n1. item 1\n2. item 2\n3. item 3';
			const output = parseContent(inputContent, descriptors);
			expect(output.myList).toEqual(['item 1', 'item 2', 'item 3']);
		});

		it('parses with multiple lists', () => {
			const inputContent = '# Your List\nitems:\n - alpha\n - beta\n# My list:\nitems:\n - charlie\n - delta\n';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'yourList', bodyOnly: true, match: { type: 'list', listIndex: 1 } },
				{ outputPath: 'myList', match: { type: 'list', listIndex: 0 } },
			];

			const output = parseContent(inputContent, descriptors);
			expect(output.myList).toEqual([' - alpha', ' - beta']);
			expect(output.yourList).toEqual(['charlie', 'delta']);
		});

		it('parses with lists inside header parent', () => {
			const inputContent = '# Your List\nitems:\n - alpha\n - beta\n# My list:\nitems:\n - charlie\n - delta\n';
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'yourList',
					bodyOnly: true,
					match: { type: 'list', listIndex: 0, parent: { type: 'header', content: 'Your List' } },
				},
				{
					outputPath: 'myList',
					bodyOnly: false,
					match: { type: 'list', listIndex: 0, parent: { type: 'header', content: 'My list:' } },
				},
			];

			const output = parseContent(inputContent, descriptors);
			expect(output.yourList).toEqual(['alpha', 'beta']);
			expect(output.myList).toEqual([' - charlie', ' - delta']);
		});

		it('parses with indexed lists inside header parent', () => {
			const inputContent = `# Your List
items:
 - alpha
 - beta
# My list
List 1:
items:
 - charlie
 - delta

List 2:
items:
 - eta
 - fox
`;
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'myList',
					bodyOnly: true,
					match: { type: 'list', listIndex: 1, parent: { type: 'header', content: 'My list' } },
				},
			];

			const output = parseContent(inputContent, descriptors);
			expect(output.myList).toEqual(['eta', 'fox']);
		});

		it('exact matches header content for parent scope', () => {
			const inputContent = '# Short Title\n - wrong\n# Short\n - correct\n';
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'output',
					bodyOnly: true,
					match: { type: 'list', listIndex: 0, parent: { type: 'header', content: 'Short' } },
				},
			];

			const output = parseContent(inputContent, descriptors);
			expect(output.output).toEqual(['correct']);
		});

		it('returns empty array when no lists exist', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'result', match: { type: 'list', listIndex: 0 } }];
			const output = parseContent('no lists here', descriptors);
			expect(output.result).toEqual([]);
		});

		it('returns empty array for out-of-bounds listIndex', () => {
			const descriptors: OutputDescriptor[] = [{ outputPath: 'result', match: { type: 'list', listIndex: 5 } }];
			const output = parseContent('- only list', descriptors);
			expect(output.result).toEqual([]);
		});

		it('contrasts bodyOnly with currentLevelOnly on same nested list', () => {
			const inputContent = `# My List
- l1
- l2
  - l2a
  - l2b
 -continued
 - l3`;

			const fullBody = parseContent(inputContent, [{ outputPath: 'list', bodyOnly: true, match: { type: 'list', listIndex: 0 } }]);
			expect(fullBody.list).toEqual(['l1', 'l2\n- l2a\n- l2b\n -continued', 'l3']);

			const currentLevel = parseContent(inputContent, [
				{ outputPath: 'list', bodyOnly: true, currentLevelOnly: true, match: { type: 'list', listIndex: 0 } },
			]);
			expect(currentLevel.list).toEqual(['l1', 'l2', 'l3']);
		});

		it('currentLevelOnly has no effect when bodyOnly is false', () => {
			const inputContent = `# My List
- l1
- l2
  - l2a
  - l2b
 -continued
 - l3`;

			const withFlag = parseContent(inputContent, [
				{ outputPath: 'list', bodyOnly: false, currentLevelOnly: true, match: { type: 'list', listIndex: 0 } },
			]);
			const withoutFlag = parseContent(inputContent, [{ outputPath: 'list', bodyOnly: false, match: { type: 'list', listIndex: 0 } }]);
			expect(withFlag.list).toEqual(withoutFlag.list);
		});

		it('parses second top-level list without header parent', () => {
			const inputContent = 'First:\n- a\n- b\n\nSecond:\n- c\n- d';
			const descriptors: OutputDescriptor[] = [{ outputPath: 'second', bodyOnly: true, match: { type: 'list', listIndex: 1 } }];
			const output = parseContent(inputContent, descriptors);
			expect(output.second).toEqual(['c', 'd']);
		});
	});

	describe('list_item extraction', () => {
		it('extracts list item by index with and without bodyOnly', () => {
			const inputContent = 'My list:\n - item 1\n - item 2\n - item 3';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'myListItem1', match: { type: 'list_item', itemIndex: 1, parent: { type: 'list', listIndex: 0 } } },
				{ outputPath: 'myListItem2', bodyOnly: true, match: { type: 'list_item', itemIndex: 2, parent: { type: 'list', listIndex: 0 } } },
			];

			const output = parseContent(inputContent, descriptors);
			expect(output).toHaveProperty('myListItem1', ' - item 2');
			expect(output).toHaveProperty('myListItem2', 'item 3');
		});

		it('extracts items from nested list using list_item parent', () => {
			const inputContent = `# My List
- l1
- l2
  - l2a
  - l2b
 -continued
 - l3`;
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'myList', bodyOnly: true, match: { type: 'list', listIndex: 0 } },
				{ outputPath: 'listItem1', bodyOnly: true, match: { type: 'list_item', itemIndex: 1 } },
				{ outputPath: 'myInnerList', bodyOnly: true, match: { type: 'list', listIndex: 0, parent: { type: 'list_item', itemIndex: 1 } } },
			];

			const output = parseContent(inputContent, descriptors);
			expect(output.myList).toEqual(['l1', 'l2\n- l2a\n- l2b\n -continued', 'l3']);
			expect(output.listItem1).toEqual('l2\n- l2a\n- l2b\n -continued');
			expect(output.myInnerList).toEqual(['l2a', 'l2b\n -continued']);
		});

		it('parses nested lists current level only', () => {
			const inputContent = `# My List
- l1
- l2
  - l2a
  - l2b
 -continued
 - l3`;
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'myList',
					bodyOnly: true,
					currentLevelOnly: true,
					match: { type: 'list', listIndex: 0 },
				},
			];

			const output = parseContent(inputContent, descriptors);
			expect(output.myList).toEqual(['l1', 'l2', 'l3']);
		});

		it('returns null for out-of-bounds itemIndex', () => {
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'result', match: { type: 'list_item', itemIndex: 10, parent: { type: 'list', listIndex: 0 } } },
			];
			const output = parseContent('- a\n- b', descriptors);
			expect(output.result).toBeNull();
		});

		it('parses list_item with header parent', () => {
			const inputContent = '# Shopping\n- apples\n- bread\n- cheese';
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'item',
					bodyOnly: true,
					match: { type: 'list_item', itemIndex: 1, parent: { type: 'header', content: 'Shopping' } },
				},
			];
			const output = parseContent(inputContent, descriptors);
			expect(output.item).toBe('bread');
		});
	});

	describe('list_labeled_item extraction', () => {
		it('extracts labeled items with and without bodyOnly', () => {
			const inputContent = 'Rating:\n - Alpha rating: 1\n - Beta rating: 56\n - Conclusion: Good!';
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'alpha',
					bodyOnly: false,
					match: { type: 'list_labeled_item', content: 'Alpha rating', parent: { type: 'list', listIndex: 0 } },
				},
				{
					outputPath: 'beta',
					bodyOnly: true,
					match: { type: 'list_labeled_item', content: 'Beta rating', parent: { type: 'list', listIndex: 0 } },
				},
				{
					outputPath: 'conclusion',
					bodyOnly: true,
					match: { type: 'list_labeled_item', content: 'Conclusion' },
				},
			];

			const output = parseContent(inputContent, descriptors);
			expect(output).toHaveProperty('alpha', ' - Alpha rating: 1');
			expect(output).toHaveProperty('beta', '56');
			expect(output).toHaveProperty('conclusion', 'Good!');
		});

		it('returns null for unmatched label', () => {
			const inputContent = '- Name: Alice\n- Age: 30';
			const descriptors: OutputDescriptor[] = [{ outputPath: 'result', match: { type: 'list_labeled_item', content: 'Missing' } }];

			const output = parseContent(inputContent, descriptors);
			expect(output).toHaveProperty('result', null);
		});

		it('matches labels case-insensitively', () => {
			const inputContent = '- Status: Active\n- Priority: High';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'status', bodyOnly: true, match: { type: 'list_labeled_item', content: 'STATUS' } },
				{ outputPath: 'priority', bodyOnly: true, match: { type: 'list_labeled_item', content: 'priority' } },
			];

			const output = parseContent(inputContent, descriptors);
			expect(output).toHaveProperty('status', 'Active');
			expect(output).toHaveProperty('priority', 'High');
		});

		it('extracts body with colons in the value', () => {
			const inputContent = '- Time: 12:30\n- URL: https://example.com';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'time', bodyOnly: true, match: { type: 'list_labeled_item', content: 'Time' } },
				{ outputPath: 'url', bodyOnly: true, match: { type: 'list_labeled_item', content: 'URL' } },
			];

			const output = parseContent(inputContent, descriptors);
			expect(output).toHaveProperty('time', '12:30');
			expect(output).toHaveProperty('url', 'https://example.com');
		});

		it('does not match partial labels', () => {
			const inputContent = '- Name: Alice\n- Name (full): Alice Smith';
			const descriptors: OutputDescriptor[] = [
				{ outputPath: 'name', bodyOnly: true, match: { type: 'list_labeled_item', content: 'Name' } },
				{ outputPath: 'nameFull', bodyOnly: true, match: { type: 'list_labeled_item', content: 'Name (full)' } },
			];

			const output = parseContent(inputContent, descriptors);
			expect(output).toHaveProperty('name', 'Alice');
			expect(output).toHaveProperty('nameFull', 'Alice Smith');
		});

		it('parses labeled item with header parent', () => {
			const inputContent = `# Section A
- Key: Value A

# Section B
- Key: Value B`;
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'keyA',
					bodyOnly: true,
					match: { type: 'list_labeled_item', content: 'Key', parent: { type: 'header', content: 'Section A' } },
				},
				{
					outputPath: 'keyB',
					bodyOnly: true,
					match: { type: 'list_labeled_item', content: 'Key', parent: { type: 'header', content: 'Section B' } },
				},
			];

			const output = parseContent(inputContent, descriptors);
			expect(output).toHaveProperty('keyA', 'Value A');
			expect(output).toHaveProperty('keyB', 'Value B');
		});

		it('parses labeled item from second list using listIndex', () => {
			const inputContent = `- Name: Alice
- Age: 30

Some text between lists

- Name: Bob
- Age: 25`;
			const descriptors: OutputDescriptor[] = [
				{
					outputPath: 'firstAge',
					bodyOnly: true,
					match: { type: 'list_labeled_item', content: 'Age', listIndex: 0 },
				},
				{
					outputPath: 'secondName',
					bodyOnly: true,
					match: { type: 'list_labeled_item', content: 'Name', listIndex: 1 },
				},
			];

			const output = parseContent(inputContent, descriptors);
			expect(output).toHaveProperty('firstAge', '30');
			expect(output).toHaveProperty('secondName', 'Bob');
		});
	});

	describe('descendancy rules', () => {
		describe('descendancy boundaries', () => {
			it('horizontal rules do not break descendancy', () => {
				const descriptors: OutputDescriptor[] = [
					{ outputPath: 'output1', match: { type: 'header', content: 'Level 1' } },
					{ outputPath: 'output2', match: { type: 'header', content: 'Level 3' } },
				];
				const inputContent = `# Level 1
lv1
## Level 2
lv2

---
### Level 3
lv3
#### Level 4
lv4
`;

				const output = parseContent(inputContent, descriptors);
				expect(output).toHaveProperty('output1', '# Level 1\nlv1\n## Level 2\nlv2\n\n---\n### Level 3\nlv3\n#### Level 4\nlv4');
				expect(output).toHaveProperty('output2', '### Level 3\nlv3\n#### Level 4\nlv4');
			});

			it('higher leveled headers break descendancy', () => {
				const descriptors: OutputDescriptor[] = [{ outputPath: 'output1', match: { type: 'header', content: 'Level 1' } }];
				const inputContent = `# Level 1
lv1
## Level 2
lv2
# Another level 1
### Level 3
lv3
#### Level 4
lv4
`;

				const output = parseContent(inputContent, descriptors);

				expect(output).toHaveProperty('output1', '# Level 1\nlv1\n## Level 2\nlv2');
			});

			it('same leveled headers break descendancy', () => {
				const descriptors: OutputDescriptor[] = [{ outputPath: 'output1', match: { type: 'header', content: 'Level 1' } }];
				const inputContent = `# Level 1
lv1
## Level 2
lv2
## Another level 2
### Level 3
lv3
#### Level 4
lv4
`;

				const output = parseContent(inputContent, descriptors);

				expect(output).toHaveProperty('output1', '# Level 1\nlv1\n## Level 2\nlv2');
			});
		});

		describe('ancestry filter', () => {
			it('higher leveled headers break ancestry', () => {
				const descriptors: OutputDescriptor[] = [
					{ outputPath: 'output1', match: { type: 'header', content: 'Level 2', ancestor: { type: 'header', content: 'Level 1' } } },
					{ outputPath: 'output2', match: { type: 'header', content: 'Level 3', ancestor: { type: 'header', content: 'Level 1' } } },
				];
				const inputContent = `# Level 1
lv1
## Level 2
lv2
# Another level 1
### Level 3
lv3
#### Level 4
lv4
`;

				const output = parseContent(inputContent, descriptors);

				expect(output).toHaveProperty('output1', '## Level 2\nlv2');
				expect(output).toHaveProperty('output2', null);
			});

			it('same leveled headers do not break ancestry', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'output',
						match: { type: 'header', content: 'Level 4', ancestor: { type: 'header', content: 'Level 1' } },
					},
				];
				const inputContent = `# Level 1
lv1
## Level 2
lv2
## Another level 2
### Level 3
lv3
#### Level 4
lv4
`;

				const output = parseContent(inputContent, descriptors);

				expect(output).toHaveProperty('output', '#### Level 4\nlv4');
			});

			it('horizontal rules do not break ancestry', () => {
				const descriptors: OutputDescriptor[] = [
					{ outputPath: 'output1', match: { type: 'header', content: 'Level 2', ancestor: { type: 'header', content: 'Level 1' } } },
					{ outputPath: 'output2', match: { type: 'header', content: 'Level 4', ancestor: { type: 'header', content: 'Level 1' } } },
					{ outputPath: 'output3', match: { type: 'header', content: 'Level 4', ancestor: { type: 'header', content: 'Level 3' } } },
				];
				const inputContent = `# Level 1
lv1
## Level 2
lv2

---
### Level 3
lv3
#### Level 4
lv4
`;

				const output = parseContent(inputContent, descriptors);

				expect(output).toHaveProperty('output1', '## Level 2\nlv2\n\n---\n### Level 3\nlv3\n#### Level 4\nlv4');
				expect(output).toHaveProperty('output2', '#### Level 4\nlv4');
				expect(output).toHaveProperty('output3', '#### Level 4\nlv4');
			});
		});

		describe('parent filter', () => {
			it('horizontal rules do not break parents and children', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'output',
						match: { type: 'header', content: 'Level 3', parent: { type: 'header', content: 'Level 2' } },
					},
				];
				const inputContent = `# Level 1
lv1
## Level 2
lv2

---

### Level 3
lv3
#### Level 4
lv4
`;

				const output = parseContent(inputContent, descriptors);

				expect(output).toHaveProperty('output', '### Level 3\nlv3\n#### Level 4\nlv4');
			});

			it('higher leveled headers break parents and children', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'output',
						match: { type: 'header', content: 'Level 3', parent: { type: 'header', content: 'Level 2' } },
					},
				];
				const inputContent = `# Level 1
lv1
## Level 2
lv2

# Another level 1
### Level 3
lv3
#### Level 4
lv4
`;

				const output = parseContent(inputContent, descriptors);

				expect(output).toHaveProperty('output', null);
			});

			it('same leveled headers break children but not parent', () => {
				const descriptors: OutputDescriptor[] = [
					{
						outputPath: 'output1',
						match: { type: 'header', content: 'Another level 2', parent: { type: 'header', content: 'Level 1' } },
					},
					{
						outputPath: 'output2',
						match: { type: 'header', content: 'Level 3', parent: { type: 'header', content: 'Level 2' } },
					},
				];
				const inputContent = `# Level 1
lv1
## Level 2
lv2
## Another level 2
### Level 3
lv3
#### Level 4
lv4
`;

				const output = parseContent(inputContent, descriptors);

				expect(output).toHaveProperty('output1', '## Another level 2\n### Level 3\nlv3\n#### Level 4\nlv4');
				expect(output).toHaveProperty('output2', null);
			});
		});
	});
});
