import { describe, it, expect, beforeEach } from 'vitest';
import {
	exitWorldBuilderMode,
	setStoryName,
	getReadyToCreate,
	getStoryName,
	getWbPhase,
	getSelectedTemplateId,
} from '../features/world-builder/world-builder.svelte';
import { WORLD_TEMPLATES } from '../features/world-builder/template-registry';

describe('world-builder state', () => {
	beforeEach(() => {
		exitWorldBuilderMode();
	});

	it('readyToCreate defaults to false after reset', () => {
		expect(getReadyToCreate()).toBe(false);
	});

	it('setStoryName updates the stored value', () => {
		setStoryName('  My Story  ');
		expect(getStoryName()).toBe('My Story');
	});

	it('getStoryName returns the typed name when set', () => {
		setStoryName('  Awesome Tale  ');
		expect(getStoryName()).toBe('Awesome Tale');
	});

	it('getStoryName falls back to "Untitled Story" when empty', () => {
		setStoryName('');
		expect(getStoryName()).toBe('Untitled Story');
		setStoryName('   ');
		expect(getStoryName()).toBe('Untitled Story');
	});

	it('wbPhase defaults to pre-template after reset', () => {
		expect(getWbPhase()).toBe('pre-template');
	});

	it('selectedTemplateId defaults to null after reset', () => {
		expect(getSelectedTemplateId()).toBe(null);
	});
});

describe('WORLD_TEMPLATES registry', () => {
	it('has 4 template entries', () => {
		expect(WORLD_TEMPLATES).toHaveLength(4);
	});

	it('contains expected template IDs', () => {
		const ids = WORLD_TEMPLATES.map((t) => t.id);
		expect(ids).toContain('high-fantasy');
		expect(ids).toContain('modern-slice-of-life');
		expect(ids).toContain('sci-fi');
		expect(ids).toContain('urban-fantasy');
	});

	it('each entry has id, label function, and loader', () => {
		for (const entry of WORLD_TEMPLATES) {
			expect(typeof entry.id).toBe('string');
			expect(entry.id.length).toBeGreaterThan(0);
			expect(typeof entry.label).toBe('function');
			expect(typeof entry.loader.loadDefault).toBe('function');
			expect(typeof entry.loader.loadByStory).toBe('function');
		}
	});
});
