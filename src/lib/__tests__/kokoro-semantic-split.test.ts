import { describe, it, expect } from 'vitest';
import { splitTextSmart, splitLongSentence } from '$lib/kokoro/semantic-split';

describe('splitTextSmart', () => {
	it('returns single chunk for short text', () => {
		const result = splitTextSmart('Hello world', 500);
		expect(result).toEqual(['Hello world']);
	});

	it('splits on paragraph boundaries', () => {
		const text = 'Para one\n\nPara two';
		const result = splitTextSmart(text, 500);
		expect(result).toEqual(['Para one', 'Para two']);
	});

	it('splits long paragraphs on sentence boundaries', () => {
		const text = 'This is sentence one. This is sentence two. This is sentence three.';
		const result = splitTextSmart(text, 40);
		expect(result.length).toBeGreaterThan(1);
		for (const chunk of result) {
			expect(chunk.length).toBeLessThanOrEqual(40);
		}
	});

	it('handles text with default maxChunkLength', () => {
		const shortText = 'Short text';
		const result = splitTextSmart(shortText);
		expect(result).toEqual(['Short text']);
	});

	it('skips empty paragraphs', () => {
		const text = 'Para one\n\n\n\nPara two';
		const result = splitTextSmart(text, 500);
		expect(result).toEqual(['Para one', 'Para two']);
	});

	it('handles single long paragraph', () => {
		const text = 'Word '.repeat(600).trim();
		const result = splitTextSmart(text, 500);
		expect(result.length).toBeGreaterThan(1);
	});

	it('uses custom maxChunkLength', () => {
		const text = 'A short sentence. Another one here. Third one now.';
		const result = splitTextSmart(text, 30);
		for (const chunk of result) {
			expect(chunk.length).toBeLessThanOrEqual(30);
		}
	});
});

describe('splitLongSentence', () => {
	it('splits on comma boundaries', () => {
		const sentence = 'First part, second part, third part, fourth part';
		const result = splitLongSentence(sentence, 30);
		expect(result.length).toBeGreaterThan(1);
		for (const chunk of result) {
			expect(chunk.length).toBeLessThanOrEqual(30);
		}
	});

	it('splits very long words by spaces', () => {
		const sentence = 'word '.repeat(50).trim();
		const result = splitLongSentence(sentence, 20);
		for (const chunk of result) {
			expect(chunk.length).toBeLessThanOrEqual(20);
		}
	});

	it('returns single chunk if sentence fits', () => {
		const result = splitLongSentence('Short sentence', 100);
		expect(result).toEqual(['Short sentence']);
	});
});
