import { describe, it, expect } from 'vitest';
import { appendReasoning, appendContent, setGameData, setMetadata, applyParserOutput, applyReasoningDelta } from '../ai/message-updater';
import type { GameData } from '../db/messages';
import type { Message, MessageMetadata } from '../ai/chat.svelte';

function createMessage(overrides?: Partial<Message>): Message {
	return {
		id: 'test-id',
		role: 'assistant',
		content: '',
		...overrides
	};
}

function createMetadata(): MessageMetadata {
	return {
		model: 'test-model',
		finishReason: 'stop',
		promptTokens: 10,
		completionTokens: 20,
		totalTokens: 30,
		durationMs: 1000
	};
}

const emptyState = { content: '', reasoning: '', gameData: null as GameData | null };

describe('message-updater', () => {
	describe('appendReasoning', () => {
		it('appends to undefined reasoning', () => {
			const msg = createMessage();
			const result = appendReasoning(msg, 'First thought');
			expect(result.reasoning).toBe('First thought');
			expect(msg.reasoning).toBeUndefined();
		});

		it('appends to existing reasoning', () => {
			const msg = createMessage({ reasoning: 'Existing' });
			const result = appendReasoning(msg, ' + new');
			expect(result.reasoning).toBe('Existing + new');
		});

		it('appends empty string', () => {
			const msg = createMessage({ reasoning: 'Existing' });
			const result = appendReasoning(msg, '');
			expect(result.reasoning).toBe('Existing');
		});
	});

	describe('appendContent', () => {
		it('appends to empty content', () => {
			const msg = createMessage();
			const result = appendContent(msg, 'Hello');
			expect(result.content).toBe('Hello');
		});

		it('appends to existing content', () => {
			const msg = createMessage({ content: 'Hello' });
			const result = appendContent(msg, ', world!');
			expect(result.content).toBe('Hello, world!');
		});
	});

	describe('setGameData', () => {
		it('sets gameData', () => {
			const msg = createMessage();
			const gameData: GameData = { worldState: 'Test state', decisions: ['Option A', 'Option B'] };
			const result = setGameData(msg, gameData);
			expect(result.gameData).toEqual(gameData);
			expect(msg.gameData).toBeUndefined();
		});

		it('replaces existing gameData', () => {
			const oldGameData: GameData = { worldState: 'Old', decisions: ['Old'] };
			const msg = createMessage({ gameData: oldGameData });
			const newGameData: GameData = { worldState: 'New', decisions: ['New'] };
			const result = setGameData(msg, newGameData);
			expect(result.gameData).toEqual(newGameData);
		});

		it('skips gameData with empty worldState', () => {
			const msg = createMessage();
			const result = setGameData(msg, { worldState: '', decisions: ['A'] });
			expect(result.gameData).toBeUndefined();
		});

		it('skips gameData with blank worldState', () => {
			const msg = createMessage();
			const result = setGameData(msg, { worldState: '   ', decisions: ['A'] });
			expect(result.gameData).toBeUndefined();
		});

		it('skips gameData with empty decisions', () => {
			const msg = createMessage();
			const result = setGameData(msg, { worldState: 'State', decisions: [] });
			expect(result.gameData).toBeUndefined();
		});

		it('preserves existing gameData when new data is invalid', () => {
			const existing: GameData = { worldState: 'Keep', decisions: ['This'] };
			const msg = createMessage({ gameData: existing });
			const result = setGameData(msg, { worldState: '', decisions: ['A'] });
			expect(result.gameData).toEqual(existing);
		});
	});

	describe('setMetadata', () => {
		it('sets reasoning and metadata', () => {
			const msg = createMessage({ reasoning: 'temp' });
			const metadata = createMetadata();
			const result = setMetadata(msg, 'final reasoning', metadata);
			expect(result.reasoning).toBe('final reasoning');
			expect(result.metadata).toEqual(metadata);
		});

		it('sets undefined reasoning', () => {
			const msg = createMessage({ reasoning: 'temp' });
			const metadata = createMetadata();
			const result = setMetadata(msg, undefined, metadata);
			expect(result.reasoning).toBeUndefined();
		});
	});

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

	describe('immutability', () => {
		it('all functions return new objects', () => {
			const msg = createMessage();
			const metadata = createMetadata();
			const gameData: GameData = { worldState: 'Test', decisions: ['A'] };

			expect(appendReasoning(msg, 'x')).not.toBe(msg);
			expect(appendContent(msg, 'x')).not.toBe(msg);
			expect(setGameData(msg, gameData)).not.toBe(msg);
			expect(setMetadata(msg, 'x', metadata)).not.toBe(msg);
		});
	});
});
