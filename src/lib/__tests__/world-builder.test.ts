import { describe, it, expect } from 'vitest';
import { extractCompletionData } from '../ai/world-builder.svelte';

describe('extractCompletionData', () => {
	it('returns null when no marker present', () => {
		expect(extractCompletionData('Hello World')).toBeNull();
		expect(extractCompletionData('')).toBeNull();
	});

	it('extracts story name and world content from valid marker', () => {
		const content = `Some intro text
[WORLD_BUILDER_COMPLETE]
My Epic Story

# World Overview
A fantasy world with magic and dragons.`;

		const result = extractCompletionData(content);
		expect(result).not.toBeNull();
		expect(result!.storyName).toBe('My Epic Story');
		expect(result!.worldContent).toBe('# World Overview\nA fantasy world with magic and dragons.');
	});

	it('returns null when marker has no content after name', () => {
		const content = `[WORLD_BUILDER_COMPLETE]
My Story
`;
		expect(extractCompletionData(content)).toBeNull();
	});

	it('treats first non-blank line as story name when blank line follows marker', () => {
		const content = `[WORLD_BUILDER_COMPLETE]

# World Overview
Some content here.`;

		// After trim(), the blank line is removed, so '# World Overview' becomes lines[0]
		const result = extractCompletionData(content);
		expect(result).not.toBeNull();
		expect(result!.storyName).toBe('# World Overview');
		expect(result!.worldContent).toBe('Some content here.');
	});

	it('handles marker at start of content', () => {
		const content = `[WORLD_BUILDER_COMPLETE]
Test Story

# Title
Content here.`;

		const result = extractCompletionData(content);
		expect(result!.storyName).toBe('Test Story');
		expect(result!.worldContent).toBe('# Title\nContent here.');
	});

	it('handles marker preceded by other text', () => {
		const content = `Great! Let me compile the world document.
[WORLD_BUILDER_COMPLETE]
Adventure Time

# Setting
A magical land.`;

		const result = extractCompletionData(content);
		expect(result!.storyName).toBe('Adventure Time');
	});

	it('handles multiline world content', () => {
		const content = `[WORLD_BUILDER_COMPLETE]
Realm of Shadows

# Geography
Mountains and valleys.

# Magic System
Elemental magic.

# Factions
The Order of Light.`;

		const result = extractCompletionData(content);
		expect(result!.worldContent).toContain('# Geography');
		expect(result!.worldContent).toContain('# Magic System');
		expect(result!.worldContent).toContain('# Factions');
	});
});
