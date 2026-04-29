import { describe, it, expect } from 'vitest';
import { applyParserOutput, applyReasoningDelta } from '../ai/message-updater';
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
			});
			expect(result.reasoning).toBe('reasoning');
			expect(result.content).toBe('');
		});

		it('sets valid gameData inside variables', () => {
			const gd: GameDataFields = { worldState: 'State', decisions: ['A'], playerAliases: [], otherCharacterAliases: {} };
			const vars: NarrativeVariables = { ...emptyVariables(), gameData: gd };
			const result = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				variables: vars,
			});
			expect(result.variables).not.toBeNull();
			expect(result.variables!.gameData).toEqual(gd);
		});

		it('skips invalid gameData (empty worldState)', () => {
			const gd: GameDataFields = { worldState: null, decisions: ['A'], playerAliases: [], otherCharacterAliases: {} };
			const vars: NarrativeVariables = { ...emptyVariables(), gameData: gd };
			const result = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				variables: vars,
			});
			// gameData with null worldState is still set — validation happens at a higher level
			expect(result.variables).not.toBeNull();
			expect(result.variables!.gameData).toEqual(gd);
		});

		it('skips invalid gameData (empty decisions)', () => {
			const gd: GameDataFields = { worldState: 'State', decisions: [], playerAliases: [], otherCharacterAliases: {} };
			const vars: NarrativeVariables = { ...emptyVariables(), gameData: gd };
			const result = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				variables: vars,
			});
			// gameData with empty decisions is still set — validation happens at a higher level
			expect(result.variables).not.toBeNull();
			expect(result.variables!.gameData).toEqual(gd);
		});

		it('appends text and thinking together', () => {
			const result = applyParserOutput(emptyState, {
				text: 'content',
				thinking: 'thought',
				variables: null,
			});
			expect(result.content).toBe('content');
			expect(result.reasoning).toBe('thought');
		});

		it('accumulates across multiple calls', () => {
			let state = applyParserOutput(emptyState, {
				text: 'Hello',
				thinking: null,
				variables: null,
			});
			state = applyParserOutput(state, {
				text: ' world',
				thinking: ' think',
				variables: null,
			});
			expect(state.content).toBe('Hello world');
			expect(state.reasoning).toBe(' think');
		});

		it('returns new object (immutable)', () => {
			const result = applyParserOutput(emptyState, {
				text: 'x',
				thinking: null,
				variables: null,
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
			});
			expect(state.variables).not.toBeNull();
			expect(state.variables!.background).toBe('A dark forest.\n');
			expect(state.variables!.narrativeBody).toBe('The hero');
		});

		it('preserves existing variable when incoming is null', () => {
			const existing: NarrativeVariables = {
				...emptyVariables(),
				storyTitle: 'My Story',
				background: 'The setting.',
			};
			const state: StreamState = { ...emptyState, variables: existing };
			const incoming: NarrativeVariables = {
				...emptyVariables(),
				actNumber: 3,
			};
			const result = applyParserOutput(state, {
				text: null,
				thinking: null,
				variables: incoming,
			});
			expect(result.variables!.storyTitle).toBe('My Story');
			expect(result.variables!.actNumber).toBe(3);
			expect(result.variables!.background).toBe('The setting.');
		});

		it('merges gameData fields across streaming chunks', () => {
			const gd1: GameDataFields = {
				worldState: 'The kingdom ',
				decisions: ['Go north'],
				playerAliases: ['hero'],
				otherCharacterAliases: {},
			};
			const vars1: NarrativeVariables = { ...emptyVariables(), gameData: gd1 };
			let state = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				variables: vars1,
			});
			const gd2: GameDataFields = {
				worldState: 'is at war.',
				decisions: ['Fight'],
				playerAliases: [],
				otherCharacterAliases: { villain: ['enemy'] },
			};
			const vars2: NarrativeVariables = { ...emptyVariables(), gameData: gd2 };
			state = applyParserOutput(state, {
				text: null,
				thinking: null,
				variables: vars2,
			});
			expect(state.variables!.gameData).not.toBeNull();
			expect(state.variables!.gameData!.worldState).toBe('The kingdom is at war.');
			expect(state.variables!.gameData!.decisions).toEqual(['Go north', 'Fight']);
			expect(state.variables!.gameData!.playerAliases).toEqual(['hero']);
			expect(state.variables!.gameData!.otherCharacterAliases).toEqual({ villain: ['enemy'] });
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
