import { describe, it, expect } from 'vitest';
import { applyParserOutput, applyReasoningDelta, mergeGameDataFields } from '../ai/message-updater';
import { type NarrativeVariables, type GameDataFields, emptyVariables } from '../ai/narrative-types';
import type { StreamState } from '../ai/chat-callbacks';

const emptyState: StreamState = {
	content: '',
	reasoning: null,
	variables: null,
};

describe('message-updater', () => {
	describe('applyParserOutput', () => {
		it('appends text', () => {
			const result = applyParserOutput(emptyState, {
				text: 'Hello',
				thinking: null,
				variables: null,
				finalizedFields: new Set(),
			});
			expect(result.content).toBe('Hello');
			expect(result.reasoning).toBeNull();
			expect(result.variables).toBeNull();
		});

		it('appends thinking', () => {
			const result = applyParserOutput(emptyState, {
				text: null,
				thinking: 'reasoning',
				variables: null,
				finalizedFields: new Set(),
			});
			expect(result.reasoning).toBe('reasoning');
			expect(result.content).toBe('');
		});

		it('sets valid gameData inside variables', () => {
			const gd: GameDataFields = { activePlotThreads: ['thread1'], decisionContext: 'A choice', decisions: ['A'] };
			const vars: NarrativeVariables = { ...emptyVariables(), gameData: gd };
			const result = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				variables: vars,
				finalizedFields: new Set(),
			});
			expect(result.variables).not.toBeNull();
			expect(result.variables!.gameData).toEqual(gd);
		});

		it('appends text and thinking together', () => {
			const result = applyParserOutput(emptyState, {
				text: 'content',
				thinking: 'thought',
				variables: null,
				finalizedFields: new Set(),
			});
			expect(result.content).toBe('content');
			expect(result.reasoning).toBe('thought');
		});

		it('accumulates across multiple calls', () => {
			let state = applyParserOutput(emptyState, {
				text: 'Hello',
				thinking: null,
				variables: null,
				finalizedFields: new Set(),
			});
			state = applyParserOutput(state, {
				text: ' world',
				thinking: ' think',
				variables: null,
				finalizedFields: new Set(),
			});
			expect(state.content).toBe('Hello world');
			expect(state.reasoning).toBe(' think');
		});

		it('returns new object (immutable)', () => {
			const result = applyParserOutput(emptyState, {
				text: 'x',
				thinking: null,
				variables: null,
				finalizedFields: new Set(),
			});
			expect(result).not.toBe(emptyState);
		});

		it('concatenates variable deltas across streaming chunks', () => {
			const vars1: NarrativeVariables = {
				...emptyVariables(),
				background: 'A dark ',
			};
			let state = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				variables: vars1,
				finalizedFields: new Set(),
			});
			const vars2: NarrativeVariables = {
				...emptyVariables(),
				background: 'forest.\n',
				narrativeBody: 'The hero',
			};
			state = applyParserOutput(state, {
				text: null,
				thinking: null,
				variables: vars2,
				finalizedFields: new Set(),
			});
			expect(state.variables).not.toBeNull();
			expect(state.variables!.background).toBe('A dark forest.\n');
			expect(state.variables!.narrativeBody).toBe('The hero');
		});

		it('replaces finalized fields instead of concatenating', () => {
			const vars1: NarrativeVariables = {
				...emptyVariables(),
				background: 'A dark ',
			};
			let state = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				variables: vars1,
				finalizedFields: new Set(),
			});
			const vars2: NarrativeVariables = {
				...emptyVariables(),
				background: 'A dark forest.\n',
			};
			state = applyParserOutput(state, {
				text: null,
				thinking: null,
				variables: vars2,
				finalizedFields: new Set(['background']),
			});
			// Finalized field should be replaced, not concatenated
			expect(state.variables!.background).toBe('A dark forest.\n');
		});

		it('preserves existing variable when incoming is null', () => {
			const existing: NarrativeVariables = {
				...emptyVariables(),
				sceneTitle: 'My Scene',
				background: 'The setting.',
			};
			const state: StreamState = { ...emptyState, variables: existing };
			const incoming: NarrativeVariables = {
				...emptyVariables(),
				narrativeBody: 'The story.',
			};
			const result = applyParserOutput(state, {
				text: null,
				thinking: null,
				variables: incoming,
				finalizedFields: new Set(),
			});
			expect(result.variables!.sceneTitle).toBe('My Scene');
			expect(result.variables!.narrativeBody).toBe('The story.');
			expect(result.variables!.background).toBe('The setting.');
		});

		it('merges gameData fields across streaming chunks', () => {
			const gd1: GameDataFields = {
				activePlotThreads: ['artifact'],
				decisionContext: 'Choose your path.',
				decisions: ['Go north'],
			};
			const vars1: NarrativeVariables = { ...emptyVariables(), gameData: gd1 };
			let state = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				variables: vars1,
				finalizedFields: new Set(),
			});
			const gd2: GameDataFields = {
				activePlotThreads: ['traitor'],
				decisionContext: null,
				decisions: ['Fight'],
			};
			const vars2: NarrativeVariables = { ...emptyVariables(), gameData: gd2 };
			state = applyParserOutput(state, {
				text: null,
				thinking: null,
				variables: vars2,
				finalizedFields: new Set(),
			});
			expect(state.variables!.gameData).not.toBeNull();
			expect(state.variables!.gameData!.activePlotThreads).toEqual(['artifact', 'traitor']);
			expect(state.variables!.gameData!.decisionContext).toBe('Choose your path.');
			expect(state.variables!.gameData!.decisions).toEqual(['Go north', 'Fight']);
		});
	});

	describe('mergeGameDataFields', () => {
		it('returns existing when incoming is null', () => {
			const existing: GameDataFields = { activePlotThreads: ['a'], decisionContext: 'ctx', decisions: ['d'] };
			const result = mergeGameDataFields(existing, null);
			expect(result).toBe(existing);
		});

		it('returns incoming when existing is null', () => {
			const incoming: GameDataFields = { activePlotThreads: ['a'], decisionContext: 'ctx', decisions: ['d'] };
			const result = mergeGameDataFields(null, incoming);
			expect(result).toBe(incoming);
		});

		it('concatenates activePlotThreads arrays', () => {
			const existing: GameDataFields = { activePlotThreads: ['a'], decisionContext: null, decisions: [] };
			const incoming: GameDataFields = { activePlotThreads: ['b'], decisionContext: null, decisions: [] };
			const result = mergeGameDataFields(existing, incoming);
			expect(result!.activePlotThreads).toEqual(['a', 'b']);
		});

		it('takes incoming decisionContext when set', () => {
			const existing: GameDataFields = { activePlotThreads: [], decisionContext: 'old', decisions: [] };
			const incoming: GameDataFields = { activePlotThreads: [], decisionContext: 'new', decisions: [] };
			const result = mergeGameDataFields(existing, incoming);
			expect(result!.decisionContext).toBe('new');
		});

		it('keeps existing decisionContext when incoming is null', () => {
			const existing: GameDataFields = { activePlotThreads: [], decisionContext: 'existing', decisions: [] };
			const incoming: GameDataFields = { activePlotThreads: [], decisionContext: null, decisions: [] };
			const result = mergeGameDataFields(existing, incoming);
			expect(result!.decisionContext).toBe('existing');
		});

		it('concatenates decisions arrays', () => {
			const existing: GameDataFields = { activePlotThreads: [], decisionContext: null, decisions: ['A'] };
			const incoming: GameDataFields = { activePlotThreads: [], decisionContext: null, decisions: ['B'] };
			const result = mergeGameDataFields(existing, incoming);
			expect(result!.decisions).toEqual(['A', 'B']);
		});
	});

	describe('applyReasoningDelta', () => {
		it('appends to null reasoning', () => {
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
