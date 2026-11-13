import { describe, it, expect, beforeAll } from 'vitest';
import { loadLocaleStrings } from '#lib/localization/index.ts';
import { formatProfileUpdateAttempt, emptyCompressionLog } from '#lib/ai/pipeline/compression-log.ts';
import type { ProfileUpdateAttempt } from '#lib/ai/pipeline/types.ts';

beforeAll(async () => {
	await loadLocaleStrings('en');
});

function attempt(overrides: Partial<ProfileUpdateAttempt['input']> = {}, success = true): ProfileUpdateAttempt {
	return {
		input: { name: 'elena-vale', ...overrides },
		result: success ? 'Profile updated for elena-vale at scene 9.' : 'Profile update failed for elena-vale: bad input',
		success,
	};
}

describe('formatProfileUpdateAttempt', () => {
	it('renders only the SUPPLIED fields (changed-only policy)', () => {
		// WHY: the pane must show what the model actually changed, not the whole profile.
		const block = formatProfileUpdateAttempt(attempt({ state: 'Recovered', goal: 'Find the healer' }));
		expect(block).toContain('### elena-vale');
		expect(block).toContain('- state: Recovered');
		expect(block).toContain('- goal: Find the healer');
		expect(block).not.toContain('logline');
		expect(block).not.toContain('traits');
		expect(block).toContain('Profile updated for elena-vale at scene 9.');
	});

	it('renders explicit null as the cleared marker (tri-state)', () => {
		const block = formatProfileUpdateAttempt(attempt({ state: null }));
		expect(block).toContain('- state: (cleared)');
	});

	it('joins arrays and renders importance', () => {
		const block = formatProfileUpdateAttempt(attempt({ traits: ['brave', 'cautious'], aliases: ['Lady Vale'], importance: 2 }));
		expect(block).toContain('- traits: brave, cautious');
		expect(block).toContain('- aliases: Lady Vale');
		expect(block).toContain('- importance: 2');
	});

	it('appends the failure result for failed attempts', () => {
		const block = formatProfileUpdateAttempt(attempt({ state: 'X' }, false));
		expect(block).toContain('Profile update failed for elena-vale: bad input');
	});

	it('separates the result from the field list with a blank line (markdown paragraph)', () => {
		// WHY: without the blank line, markdown lazy continuation renders the result
		// inside the last list bullet (observed on the traits line in the dialog).
		const block = formatProfileUpdateAttempt(attempt({ traits: ['brave'] }));
		expect(block).toContain('- traits: brave\n\nProfile updated for elena-vale at scene 9.');
	});
});

describe('emptyCompressionLog', () => {
	it('is a localized no-changes marker (quiet run)', () => {
		expect(emptyCompressionLog()).toBe('No profile changes — the new material did not justify any updates.');
	});
});
