import { describe, expect, it } from 'vitest';
import { orderStories } from '$lib/stores/stories.svelte';
import type { Story } from '$lib/db/stories';

function makeStory(id: string, updatedAt: number): Story {
	return { id, name: id, locale: 'en', createdAt: 0, updatedAt };
}

describe('orderStories', () => {
	// getAllStories() returns updated_at DESC; the helper receives that order.
	const loaded = [makeStory('b', 200), makeStory('a', 100), makeStory('c', 50)];

	it('keeps updated_at DESC when no manual order exists', () => {
		expect(orderStories(loaded, []).map((s) => s.id)).toEqual(['b', 'a', 'c']);
	});

	it('listed stories follow the manual order', () => {
		expect(orderStories(loaded, ['c', 'b', 'a']).map((s) => s.id)).toEqual(['c', 'b', 'a']);
	});

	it('stories absent from the order come first (new/imported on top)', () => {
		expect(orderStories(loaded, ['a']).map((s) => s.id)).toEqual(['b', 'c', 'a']);
	});

	it('ignores order entries for deleted stories', () => {
		expect(orderStories(loaded, ['gone', 'a', 'b', 'c']).map((s) => s.id)).toEqual(['a', 'b', 'c']);
	});
});
