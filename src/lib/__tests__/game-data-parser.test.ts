import { describe, it, expect } from 'vitest';
import { createGameDataParser } from '../ai/game-data-parser';
import type { GameData } from '../db/messages';

function feedAll(chunks: string[]): { text: string; gameData: GameData | null } {
	const parser = createGameDataParser();
	let text = '';
	let gameData: GameData | null = null;

	for (const chunk of chunks) {
		const acc: { gameData: GameData | null } = { gameData: null };
		const result = parser.feed(chunk, acc);
		if (result) text += result;
		if (acc.gameData) gameData = acc.gameData;
	}

	const acc: { gameData: GameData | null } = { gameData: null };
	const flushed = parser.flush(acc);
	if (flushed) text += flushed;
	if (acc.gameData) gameData = acc.gameData;

	return { text, gameData };
}

const VALID_GAME_DATA = JSON.stringify({
	worldState: 'The hero stands at a crossroads.',
	decisions: ['Go left', 'Go right', 'Go straight'],
});

describe('GameDataParser', () => {
	describe('plain text passthrough', () => {
		it('passes plain text through unchanged', () => {
			const { text, gameData } = feedAll(['Hello, world!']);
			expect(text).toBe('Hello, world!');
			expect(gameData).toBeNull();
		});

		it('passes text with inline code through unchanged', () => {
			const { text, gameData } = feedAll(['Use `console.log` for debugging']);
			expect(text).toBe('Use `console.log` for debugging');
			expect(gameData).toBeNull();
		});

		it('passes double backticks through unchanged', () => {
			const { text, gameData } = feedAll(['Some ``text`` here']);
			expect(text).toBe('Some ``text`` here');
			expect(gameData).toBeNull();
		});

		it('passes non-json code blocks through as text', () => {
			const input = 'Before\n```python\nprint("hi")\n```\nAfter';
			const { text, gameData } = feedAll([input]);
			expect(text).toBe(input);
			expect(gameData).toBeNull();
		});
	});

	describe('game data block extraction', () => {
		it('extracts valid game data block and strips it from text', () => {
			const input = `The story continues.\n\`\`\`json\n${VALID_GAME_DATA}\n\`\`\``;
			const { text, gameData } = feedAll([input]);
			expect(text).toBe('The story continues.\n');
			expect(gameData).toEqual({
				worldState: 'The hero stands at a crossroads.',
				decisions: ['Go left', 'Go right', 'Go straight'],
			});
		});

		it('handles game data at the start of content', () => {
			const input = `\`\`\`json\n${VALID_GAME_DATA}\n\`\`\`\nMore text`;
			const { text, gameData } = feedAll([input]);
			expect(text).toBe('\nMore text');
			expect(gameData).not.toBeNull();
		});

		it('handles game data as the entire content', () => {
			const input = `\`\`\`json\n${VALID_GAME_DATA}\n\`\`\``;
			const { text, gameData } = feedAll([input]);
			expect(text).toBe('');
			expect(gameData).not.toBeNull();
		});
	});

	describe('invalid game data blocks', () => {
		it('flushes malformed JSON as text', () => {
			const input = 'Before\n```json\n{not valid json}\n```\nAfter';
			const { text, gameData } = feedAll([input]);
			expect(text).toBe(input);
			expect(gameData).toBeNull();
		});

		it('flushes JSON without worldState as text', () => {
			const json = JSON.stringify({ decisions: ['A', 'B'] });
			const input = `\`\`\`json\n${json}\n\`\`\``;
			const { text, gameData } = feedAll([input]);
			expect(text).toBe(input);
			expect(gameData).toBeNull();
		});

		it('flushes JSON without decisions as text', () => {
			const json = JSON.stringify({ worldState: 'State' });
			const input = `\`\`\`json\n${json}\n\`\`\``;
			const { text, gameData } = feedAll([input]);
			expect(text).toBe(input);
			expect(gameData).toBeNull();
		});

		it('flushes JSON with non-string decisions as text', () => {
			const json = JSON.stringify({ worldState: 'State', decisions: [1, 2, 3] });
			const input = `\`\`\`json\n${json}\n\`\`\``;
			const { text, gameData } = feedAll([input]);
			expect(text).toBe(input);
			expect(gameData).toBeNull();
		});
	});

	describe('chunked streaming', () => {
		it('handles game data split across many chunks', () => {
			const input = `The story.\n\`\`\`json\n${VALID_GAME_DATA}\n\`\`\``;
			// Split into 2-char chunks
			const chunks: string[] = [];
			for (let i = 0; i < input.length; i += 2) {
				chunks.push(input.slice(i, i + 2));
			}
			const { text, gameData } = feedAll(chunks);
			expect(text).toBe('The story.\n');
			expect(gameData).toEqual({
				worldState: 'The hero stands at a crossroads.',
				decisions: ['Go left', 'Go right', 'Go straight'],
			});
		});

		it('handles backtick split across chunk boundary', () => {
			const chunks = ['Text', '`\n', '``', 'json\n', VALID_GAME_DATA, '\n```', ' end'];
			// This tests: ` followed by `` which forms ```
			// Actually let's test properly - the full ```json arrives across chunks
			const chunks2 = ['Hello\n`', '``json\n', VALID_GAME_DATA + '\n', '```', '\nDone'];
			const { text, gameData } = feedAll(chunks2);
			expect(text).toBe('Hello\n\nDone');
			expect(gameData).not.toBeNull();
		});
	});

	describe('stream interruption', () => {
		it('flushes buffer as text when stream ends mid-opener', () => {
			const chunks = ['Hello `', '``'];
			const { text, gameData } = feedAll(chunks);
			expect(text).toBe('Hello ```');
			expect(gameData).toBeNull();
		});

		it('flushes buffer as text when stream ends during JSON body', () => {
			const chunks = ['Text\n```json\n{"partial": true}'];
			const { text, gameData } = feedAll(chunks);
			expect(text).toBe('Text\n```json\n{"partial": true}');
			expect(gameData).toBeNull();
		});

		it('flushes buffer as text when stream ends with partial closing', () => {
			const chunks = ['Text\n```json\n{"worldState":"s","decisions":[]}\n`'];
			const { text, gameData } = feedAll(chunks);
			expect(text).toBe('Text\n```json\n{"worldState":"s","decisions":[]}\n`');
			expect(gameData).toBeNull();
		});
	});

	describe('edge cases', () => {
		it('handles empty decisions array', () => {
			const json = JSON.stringify({ worldState: 'State', decisions: [] });
			const input = `\`\`\`json\n${json}\n\`\`\``;
			const { text, gameData } = feedAll([input]);
			expect(text).toBe('');
			expect(gameData).toEqual({ worldState: 'State', decisions: [] });
		});

		it('handles backticks inside JSON content', () => {
			const json = JSON.stringify({
				worldState: 'He said `hello`',
				decisions: ['A'],
			});
			const input = `\`\`\`json\n${json}\n\`\`\``;
			const { text, gameData } = feedAll([input]);
			expect(text).toBe('');
			expect(gameData).not.toBeNull();
			expect(gameData!.worldState).toBe('He said `hello`');
		});

		it('handles single backtick followed by non-backtick', () => {
			const chunks = ['Before `x` after'];
			const { text, gameData } = feedAll(chunks);
			expect(text).toBe('Before `x` after');
			expect(gameData).toBeNull();
		});

		it('handles multiple code blocks where only one is game data', () => {
			const input = `Text\n\`\`\`python\nprint("hi")\n\`\`\`\nMore\n\`\`\`json\n${VALID_GAME_DATA}\n\`\`\`\nEnd`;
			const { text, gameData } = feedAll([input]);
			expect(text).toBe('Text\n```python\nprint("hi")\n```\nMore\n\nEnd');
			expect(gameData).not.toBeNull();
		});
	});
});
