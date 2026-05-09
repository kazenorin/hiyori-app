import { describe, it, expect } from 'vitest';
import { parseContent } from '../chat-stream-parser/parser';
import type { OutputDescriptor } from '../chat-stream-parser/types';

const NARRATIVE_BODY_DESCRIPTOR: OutputDescriptor = {
	outputPath: 'narrativeBody',
	match: { type: 'header', content: 'Narrative Body' },
	bodyOnly: true,
};

describe('parseContent with horizontal rules', () => {
	it('captures body content after horizontal rule within a section', () => {
		const content = `# Narrative Body
part one

---
part two

---
part three`;

		const result = parseContent(content, [NARRATIVE_BODY_DESCRIPTOR]) as { narrativeBody: string };
		expect(result.narrativeBody).toContain('part one');
		expect(result.narrativeBody).toContain('part two');
		expect(result.narrativeBody).toContain('part three');
	});

	it('includes the horizontal rule in the body content', () => {
		const content = `# Narrative Body
part one

---
part two`;

		const result = parseContent(content, [NARRATIVE_BODY_DESCRIPTOR]) as { narrativeBody: string };
		expect(result.narrativeBody).toContain('---');
		expect(result.narrativeBody).toContain('part one');
		expect(result.narrativeBody).toContain('part two');
	});

	it('works with multiple sections and horizontal rules', () => {
		const content = `# Scene Title
My Scene
# Narrative Body
part one

---
part two
# Background
Some background info`;

		const descriptors: OutputDescriptor[] = [
			{ outputPath: 'sceneTitle', match: { type: 'header', content: 'Scene Title' }, bodyOnly: true },
			{ outputPath: 'narrativeBody', match: { type: 'header', content: 'Narrative Body' }, bodyOnly: true },
			{ outputPath: 'background', match: { type: 'header', content: 'Background' }, bodyOnly: true },
		];

		const result = parseContent(content, descriptors) as {
			sceneTitle: string;
			narrativeBody: string;
			background: string;
		};

		expect(result.sceneTitle).toBe('My Scene');
		expect(result.narrativeBody).toContain('part one');
		expect(result.narrativeBody).toContain('part two');
		expect(result.background).toBe('Some background info');
	});

	it('handles horizontal rule at top level without sections', () => {
		const content = `---
# Narrative Body
some content`;

		const result = parseContent(content, [NARRATIVE_BODY_DESCRIPTOR]) as { narrativeBody: string };
		expect(result.narrativeBody).toBe('some content');
	});
});
