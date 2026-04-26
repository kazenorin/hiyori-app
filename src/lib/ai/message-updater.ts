import type { GameData } from '$lib/db/messages';
import type { StreamState } from './chat-callbacks';
import { type NarrativeSections, emptySections, NARRATIVE_SECTION_FIELDS } from './parser-chain';

function mergeSections(existing: NarrativeSections | null, incoming: NarrativeSections | null): NarrativeSections | null {
	if (!incoming) return existing;
	if (!existing) return incoming;
	const result = emptySections();
	for (const field of NARRATIVE_SECTION_FIELDS) {
		result[field] = incoming[field] ?? existing[field];
	}
	return result;
}

export function applyParserOutput(state: StreamState, output: import('./parser-chain').ParserChainOutput): StreamState {
	return {
		content: state.content + (output.text ?? ''),
		reasoning: appendDelta(state.reasoning, output.thinking),
		gameData: output.gameData && isValidGameData(output.gameData) ? output.gameData : state.gameData,
		reviewScratchpad: appendDelta(state.reviewScratchpad, output.reviewScratchpad),
		revisedNarrative: appendDelta(state.revisedNarrative, output.revisedNarrative),
		revisedGameData: output.revisedGameData && isValidGameData(output.revisedGameData) ? output.revisedGameData : state.revisedGameData,
		sections: mergeSections(state.sections, output.sections),
	};
}

export function applyReasoningDelta(state: StreamState, text: string): StreamState {
	return {
		...state,
		reasoning: (state.reasoning ?? '') + text,
	};
}

function appendDelta(existing: string | null, delta: string | null): string | null {
	return delta != null ? (existing != null ? existing + delta : delta) : existing;
}

function isValidGameData(gameData: GameData): boolean {
	return gameData.worldState.trim().length > 0 && gameData.decisions.length > 0;
}
