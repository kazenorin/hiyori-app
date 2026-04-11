import { describe, it, expect } from 'vitest';
import { applyParserOutput, applyReasoningDelta } from '../ai/message-updater';
import type { GameData } from '../db/messages';
import type { Message } from '../ai/chat.svelte';

function createMessage(overrides?: Partial<Message>): Message {
	return {
		id: 'test-id',
		role: 'assistant',
		content: '',
		...overrides
	};
}

const emptyState = { content: '', reasoning: '', gameData: null as GameData | null };

describe('message-updater', () => {
	describe('applyParserOutput', () => {
		it('appends text', () => {
			const result = applyParserOutput(emptyState, { text: 'Hello', thinking: null, gameData: null });
			expect(result.content).toBe('Hello');
			expect(result.reasoning).toBe('');
			expect(result.gameData).toBeNull();
		});

		it('appends thinking', () => {
			const result = applyParserOutput(emptyState, { text: null, thinking: 'reasoning', gameData: null });
			expect(result.reasoning).toBe('reasoning');
			expect(result.content).toBe('');
		});

		it('sets valid gameData', () => {
			const gd: GameData = { worldState: 'State', decisions: ['A'] };
			const result = applyParserOutput(emptyState, { text: null, thinking: null, gameData: gd });
			expect(result.gameData).toEqual(gd);
		});

		it('skips invalid gameData (empty worldState)', () => {
			const gd: GameData = { worldState: '', decisions: ['A'] };
			const result = applyParserOutput(emptyState, { text: null, thinking: null, gameData: gd });
			expect(result.gameData).toBeNull();
		});

		it('skips invalid gameData (empty decisions)', () => {
			const gd: GameData = { worldState: 'State', decisions: [] };
			const result = applyParserOutput(emptyState, { text: null, thinking: null, gameData: gd });
			expect(result.gameData).toBeNull();
		});

		it('appends text and thinking together', () => {
			const result = applyParserOutput(emptyState, { text: 'content', thinking: 'thought', gameData: null });
			expect(result.content).toBe('content');
			expect(result.reasoning).toBe('thought');
		});

		it('accumulates across multiple calls', () => {
			let state = applyParserOutput(emptyState, { text: 'Hello', thinking: null, gameData: null });
			state = applyParserOutput(state, { text: ' world', thinking: ' think', gameData: null });
			expect(state.content).toBe('Hello world');
			expect(state.reasoning).toBe(' think');
		});

		it('returns new object (immutable)', () => {
			const result = applyParserOutput(emptyState, { text: 'x', thinking: null, gameData: null });
			expect(result).not.toBe(emptyState);
		});
	});

	describe('applyReasoningDelta', () => {
		it('appends to empty reasoning', () => {
			const result = applyReasoningDelta(emptyState, 'delta');
			expect(result.reasoning).toBe('delta');
		});

		it('appends to existing reasoning', () => {
			const state = { ...emptyState, reasoning: 'existing' };
			const result = applyReasoningDelta(state, ' + more');
			expect(result.reasoning).toBe('existing + more');
		});

		it('returns new object (immutable)', () => {
			const result = applyReasoningDelta(emptyState, 'x');
			expect(result).not.toBe(emptyState);
		});
	});
});
