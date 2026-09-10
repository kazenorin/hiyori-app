import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/localization', () => ({
	ls: (key: string) => {
		const map: Record<string, string> = {
			'common.headers.requirements': 'Requirements',
			'common.descriptions.requirements': 'Honor every requirement.',
			'common.labels.requirementCategories.must': 'Must',
			'common.labels.requirementCategories.should': 'Should',
			'common.labels.requirementCategories.may': 'May',
			'common.labels.requirementCategories.mustNot': 'Must not',
			'common.labels.requirementCategories.will': 'Will',
		};
		return map[key] ?? key;
	},
}));

import {
	formatRequirementsBlock,
	formatRequirementsContext,
	formatRequirementsBlockFromLines,
	renderRequirementsText,
	isDuplicateRequirement,
	appendRequirementLine,
	type Requirement,
} from '$lib/definitions/requirements';

const req = (category: Requirement['category'], requirement: string): Requirement => ({ category, requirement });

describe('renderRequirementsText', () => {
	it('renders one modal-labeled bullet per requirement in recording order', () => {
		const text = renderRequirementsText([req('must', 'A'), req('may', 'B'), req('mustNot', 'C')]);
		expect(text).toBe('- **Must:** A\n- **May:** B\n- **Must not:** C');
	});

	it('returns empty string for an empty list', () => {
		expect(renderRequirementsText([])).toBe('');
	});
});

describe('formatRequirementsBlock', () => {
	it('returns empty string when there are no requirements (nothing to write)', () => {
		expect(formatRequirementsBlock([])).toBe('');
	});

	it('prefixes the rendered lines with the Requirements header', () => {
		expect(formatRequirementsBlock([req('will', 'X')])).toBe('## Requirements\n\n- **Will:** X');
	});
});

describe('formatRequirementsContext', () => {
	it('returns empty string when there are no requirements (no injection)', () => {
		expect(formatRequirementsContext([])).toBe('');
	});

	it('adds header + honor-description before the lines for prompt injection', () => {
		expect(formatRequirementsContext([req('should', 'Y')])).toBe('## Requirements\n\nHonor every requirement.\n\n- **Should:** Y');
	});
});

describe('formatRequirementsBlockFromLines', () => {
	it('rebuilds the headed block from header-less sidecar lines', () => {
		expect(formatRequirementsBlockFromLines('- **Must:** A\n- **May:** B')).toBe('## Requirements\n\n- **Must:** A\n- **May:** B');
	});

	it('returns empty string for blank input', () => {
		expect(formatRequirementsBlockFromLines('   \n ')).toBe('');
	});
});

describe('isDuplicateRequirement', () => {
	it('detects an exact category+text match', () => {
		expect(isDuplicateRequirement([req('must', 'A')], req('must', 'A'))).toBe(true);
	});

	it('allows the same text under a different category', () => {
		expect(isDuplicateRequirement([req('must', 'A')], req('may', 'A'))).toBe(false);
	});
});

describe('appendRequirementLine', () => {
	it('seeds a header-less file with the first rendered line', () => {
		expect(appendRequirementLine('', req('must', 'A'))).toBe('- **Must:** A');
	});

	it('appends subsequent lines preserving order', () => {
		expect(appendRequirementLine('- **Must:** A', req('may', 'B'))).toBe('- **Must:** A\n- **May:** B');
	});

	it('is a no-op when the exact line already exists (dedup survives resume)', () => {
		expect(appendRequirementLine('- **Must:** A', req('must', 'A'))).toBe('- **Must:** A');
	});
});
