import { describe, it, expect } from 'vitest';
import { applyParserOutput, applyReasoningDelta } from '../ai/message-updater';
import type { GameData } from '../db/messages';
import type { NarrativeSections } from '../ai/parser-chain';

const emptyState = {
	content: '',
	reasoning: '',
	gameData: null as GameData | null,
	reviewScratchpad: null as string | null,
	revisedNarrative: null as string | null,
	revisedGameData: null as GameData | null,
	sections: null as null,
};

describe('message-updater', () => {
	describe('applyParserOutput', () => {
		it('appends text', () => {
			const result = applyParserOutput(emptyState, {
				text: 'Hello',
				thinking: null,
				gameData: null,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: null,
			});
			expect(result.content).toBe('Hello');
			expect(result.reasoning).toBe('');
			expect(result.gameData).toBeNull();
		});

		it('appends thinking', () => {
			const result = applyParserOutput(emptyState, {
				text: null,
				thinking: 'reasoning',
				gameData: null,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: null,
			});
			expect(result.reasoning).toBe('reasoning');
			expect(result.content).toBe('');
		});

		it('sets valid gameData', () => {
			const gd: GameData = { worldState: 'State', decisions: ['A'] };
			const result = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				gameData: gd,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: null,
			});
			expect(result.gameData).toEqual(gd);
		});

		it('skips invalid gameData (empty worldState)', () => {
			const gd: GameData = { worldState: '', decisions: ['A'] };
			const result = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				gameData: gd,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: null,
			});
			expect(result.gameData).toBeNull();
		});

		it('skips invalid gameData (empty decisions)', () => {
			const gd: GameData = { worldState: 'State', decisions: [] };
			const result = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				gameData: gd,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: null,
			});
			expect(result.gameData).toBeNull();
		});

		it('appends text and thinking together', () => {
			const result = applyParserOutput(emptyState, {
				text: 'content',
				thinking: 'thought',
				gameData: null,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: null,
			});
			expect(result.content).toBe('content');
			expect(result.reasoning).toBe('thought');
		});

		it('accumulates across multiple calls', () => {
			let state = applyParserOutput(emptyState, {
				text: 'Hello',
				thinking: null,
				gameData: null,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: null,
			});
			state = applyParserOutput(state, {
				text: ' world',
				thinking: ' think',
				gameData: null,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: null,
			});
			expect(state.content).toBe('Hello world');
			expect(state.reasoning).toBe(' think');
		});

		it('returns new object (immutable)', () => {
			const result = applyParserOutput(emptyState, {
				text: 'x',
				thinking: null,
				gameData: null,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: null,
			});
			expect(result).not.toBe(emptyState);
		});

		it('concatenates section deltas across streaming chunks', () => {
			const s1: NarrativeSections = {
				storyTitle: null,
				actNumber: null,
				sessionNumber: null,
				sceneNumber: null,
				sceneTitle: null,
				background: 'A dark ',
				narrativeBody: null,
				cg: null,
				currentContext: null,
				activePlotThreads: null,
				decisionContext: null,
			};
			let state = applyParserOutput(emptyState, {
				text: null,
				thinking: null,
				gameData: null,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: s1,
			});
			const s2: NarrativeSections = {
				storyTitle: null,
				actNumber: null,
				sessionNumber: null,
				sceneNumber: null,
				sceneTitle: null,
				background: 'forest.\n',
				narrativeBody: 'The hero',
				cg: null,
				currentContext: null,
				activePlotThreads: null,
				decisionContext: null,
			};
			state = applyParserOutput(state, {
				text: null,
				thinking: null,
				gameData: null,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: s2,
			});
			expect(state.sections).not.toBeNull();
			expect(state.sections!.background).toBe('A dark forest.\n');
			expect(state.sections!.narrativeBody).toBe('The hero');
		});

		it('preserves existing section when incoming is null', () => {
			const existing: NarrativeSections = {
				storyTitle: 'My Story',
				actNumber: null,
				sessionNumber: null,
				sceneNumber: null,
				sceneTitle: null,
				background: 'The setting.',
				narrativeBody: null,
				cg: null,
				currentContext: null,
				activePlotThreads: null,
				decisionContext: null,
			};
			const state = { ...emptyState, sections: existing };
			const incoming: NarrativeSections = {
				storyTitle: null,
				actNumber: '3',
				sessionNumber: null,
				sceneNumber: null,
				sceneTitle: null,
				background: null,
				narrativeBody: null,
				cg: null,
				currentContext: null,
				activePlotThreads: null,
				decisionContext: null,
			};
			const result = applyParserOutput(state, {
				text: null,
				thinking: null,
				gameData: null,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null,
				sections: incoming,
			});
			expect(result.sections!.storyTitle).toBe('My Story');
			expect(result.sections!.actNumber).toBe('3');
			expect(result.sections!.background).toBe('The setting.');
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
