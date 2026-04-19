import { describe, it, expect } from 'vitest';
import { createStreamAccumulator, type StreamState } from '../ai/chat-callbacks';
import type { GameData } from '../db/messages';

const T = 'think';
const emptyMetadata = {
	finishReason: 'finished',
	usage: {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
	},
	durationMs: 1,
};

function feedAll(chunks: string[]): { text: string; reasoning: string | null; gameData: GameData | null } {
	const acc = createStreamAccumulator();

	for (const chunk of chunks) {
		acc.callbacks.onTextDelta(chunk);
	}

	acc.callbacks.onComplete(emptyMetadata);

	return {
		text: acc.state.content,
		reasoning: acc.state.reasoning,
		gameData: acc.state.gameData,
	};
}

const GAME_DATA_JSON = JSON.stringify({
	worldState: 'The hero stands at a crossroads.',
	decisions: ['Go left', 'Go right'],
});

describe('createStreamAccumulator', () => {
	describe('text accumulation', () => {
		it('accumulates plain text', () => {
			const result = feedAll(['Hello', ' ', 'world']);
			expect(result.text).toBe('Hello world');
			expect(result.reasoning).toBeNull();
			expect(result.gameData).toBeNull();
		});

		it('accumulates text across many small chunks', () => {
			const result = feedAll(['a', 'b', 'c', 'd']);
			expect(result.text).toBe('abcd');
		});
	});

	describe('reasoning from thinking tags', () => {
		it('extracts reasoning from thinking tags', () => {
			const result = feedAll([`<${T}>Deep thought</${T}>Response`]);
			expect(result.reasoning).toBe('Deep thought');
			expect(result.text).toBe('Response');
		});

		it('extracts reasoning across chunked thinking tags', () => {
			const result = feedAll([`<${T}>Part 1`, ` Part 2</${T}>Text`]);
			expect(result.reasoning).toBe('Part 1 Part 2');
			expect(result.text).toBe('Text');
		});
	});

	describe('reasoning delta', () => {
		it('accumulates explicit reasoning deltas', () => {
			const acc = createStreamAccumulator();
			if (acc.callbacks.onReasoningDelta) {
				acc.callbacks.onReasoningDelta('First');
			}
			if (acc.callbacks.onReasoningDelta) {
				acc.callbacks.onReasoningDelta(' Second');
			}
			expect(acc.state.reasoning).toBe('First Second');
		});

		it('accumulates reasoning from both thinking tags and deltas', () => {
			const acc = createStreamAccumulator();
			acc.callbacks.onTextDelta(`<${T}>Tag reasoning</${T}>`);
			if (acc.callbacks.onReasoningDelta) {
				acc.callbacks.onReasoningDelta(' Delta reasoning');
			}
			expect(acc.state.reasoning).toBe('Tag reasoning Delta reasoning');
		});
	});

	describe('game data', () => {
		it('extracts valid game data', () => {
			const input = `Story\n\`\`\`json\n${GAME_DATA_JSON}\n\`\`\`\nEnd`;
			const result = feedAll([input]);
			expect(result.gameData).not.toBeNull();
			expect(result.gameData?.decisions).toEqual(['Go left', 'Go right']);
			expect(result.text).toContain('Story');
		});

		it('skips game data with empty worldState', () => {
			const gd = JSON.stringify({ worldState: '', decisions: ['A'] });
			const result = feedAll([`\`\`\`json\n${gd}\n\`\`\``]);
			expect(result.gameData).toBeNull();
		});

		it('skips game data with blank worldState', () => {
			const gd = JSON.stringify({ worldState: '   ', decisions: ['A'] });
			const result = feedAll([`\`\`\`json\n${gd}\n\`\`\``]);
			expect(result.gameData).toBeNull();
		});

		it('skips game data with empty decisions', () => {
			const gd = JSON.stringify({ worldState: 'State', decisions: [] });
			const result = feedAll([`\`\`\`json\n${gd}\n\`\`\``]);
			expect(result.gameData).toBeNull();
		});

		it('extracts game data alongside thinking tags', () => {
			const chunks = [`<${T}>reasoning</${T}>`, `Story\n\`\`\`json\n`, GAME_DATA_JSON, '\n\`\`\`\nEnd'];
			const result = feedAll(chunks);
			expect(result.reasoning).toBe('reasoning');
			expect(result.gameData).not.toBeNull();
			expect(result.text).toBe('Story\n\nEnd');
		});
	});

	describe('onUpdate callback', () => {
		it('calls onUpdate on each text delta', () => {
			const updates: string[] = [];
			const acc = createStreamAccumulator((state) => {
				updates.push(state.content);
			});
			acc.callbacks.onTextDelta('a');
			acc.callbacks.onTextDelta('b');
			expect(updates).toEqual(['a', 'ab']);
		});

		it('calls onUpdate on reasoning delta', () => {
			const updates: string[] = [];
			const acc = createStreamAccumulator((state) => {
				if (state.reasoning) {
					updates.push(state.reasoning);
				}
			});
			if (acc.callbacks.onReasoningDelta) {
				acc.callbacks.onReasoningDelta('thought');
			}
			expect(updates).toEqual(['thought']);
		});

		it('does not call onUpdate when output is empty', () => {
			const updates: string[] = [];
			const acc = createStreamAccumulator((state) => {
				updates.push(state.content);
			});
			acc.callbacks.onTextDelta('');
			expect(updates).toHaveLength(0);
		});
	});

	describe('flush', () => {
		it('flushes remaining buffered content', () => {
			const acc = createStreamAccumulator();
			acc.callbacks.onTextDelta(`<${T}>Incomplete`);
			expect(acc.state.content).toBe('');
			acc.callbacks.onComplete(emptyMetadata);
			expect(acc.state.content).toContain(`<${T}>`);
			expect(acc.state.content).toContain('Incomplete');
		});
	});

	describe('immutability', () => {
		it('state is replaced not mutated on text delta', () => {
			const states: Array<{ content: string }> = [];
			const acc = createStreamAccumulator((state) => {
				states.push(state);
			});
			acc.callbacks.onTextDelta('a');
			acc.callbacks.onTextDelta('b');
			expect(states[0].content).toBe('a');
			expect(states[1].content).toBe('ab');
		});

		it('state is replaced not mutated on reasoning delta', () => {
			const states: Array<StreamState> = [];
			const acc = createStreamAccumulator((state) => {
				states.push(state);
			});
			if (acc.callbacks.onReasoningDelta) {
				acc.callbacks.onReasoningDelta('x');
			}
			if (acc.callbacks.onReasoningDelta) {
				acc.callbacks.onReasoningDelta('y');
			}
			expect(states[0].reasoning).toBe('x');
			expect(states[1].reasoning).toBe('xy');
		});
	});

	describe('onError flush', () => {
		it('flushes buffered content on error before rejecting', async () => {
			const acc = createStreamAccumulator();
			acc.callbacks.onTextDelta(`<${T}>Incomplete`);
			expect(acc.state.content).toBe('');
			expect(acc.state.reasoning).toBeNull();

			const error = new Error('stream failed');
			acc.callbacks.onError(error);

			// Buffered thinking tag should be flushed as text content
			expect(acc.state.content).toContain(`<${T}>`);
			expect(acc.state.content).toContain('Incomplete');

			// resultMetadata promise should reject
			await expect(acc.resultMetadata).rejects.toThrow('stream failed');
		});
	});
});
