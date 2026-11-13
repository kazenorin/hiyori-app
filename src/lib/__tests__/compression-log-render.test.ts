import { describe, it, expect, beforeAll } from 'vitest';
import { marked } from 'marked';
import { loadLocaleStrings, ls } from '#lib/localization/index.ts';
import { preprocessDialogue } from '#lib/utils/dialogue-preprocessor.ts';
import { formatProfileUpdateAttempt } from '#lib/ai/pipeline/compression-log.ts';

beforeAll(async () => {
	await loadLocaleStrings('en');
});

describe('compression log rendering', () => {
	// WHY: the log is markdown rendered later; the result must be its own
	// paragraph, not a lazy-continuation line inside the last list bullet.
	it('renders the result as a paragraph separate from the field list', () => {
		const block = formatProfileUpdateAttempt({
			input: { name: 'Amiri Verspera', state: 'Recovered', traits: ['brave'] },
			result: ls('tools.updateCharacterProfile.messages.updated', { name: 'Amiri Verspera', sceneNumber: 5 }),
			success: true,
		});
		const html = marked.parse(preprocessDialogue(block, ['Amiri Verspera'], []), { async: false });
		expect(html).toContain('</ul>\n<p>Profile updated');
		expect(html).not.toMatch(/<li>(?:(?!<\/li>)[\s\S])*Profile updated/);
	});
});
