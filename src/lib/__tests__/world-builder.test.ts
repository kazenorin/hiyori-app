import { describe, it, expect, beforeEach } from 'vitest';
import { exitWorldBuilderMode, setStoryName, getReadyToCreate, getStoryName } from '../features/world-builder/world-builder.svelte';

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
});
