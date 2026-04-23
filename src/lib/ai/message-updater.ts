import type { GameData } from '$lib/db/messages';
import type { StreamState } from './chat-callbacks';
import type { ParserChainOutput } from './parser-chain';

export function applyParserOutput(state: StreamState, output: ParserChainOutput): StreamState {
	return {
		content: state.content + (output.text ?? ''),
		reasoning: appendDelta(state.reasoning, output.thinking),
		gameData: output.gameData && isValidGameData(output.gameData) ? output.gameData : state.gameData,
		reviewScratchpad: appendDelta(state.reviewScratchpad, output.reviewScratchpad),
		revisedNarrative: appendDelta(state.revisedNarrative, output.revisedNarrative),
		revisedGameData: output.revisedGameData && isValidGameData(output.revisedGameData) ? output.revisedGameData : state.revisedGameData,
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
