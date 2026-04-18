import type { GameData } from '$lib/db/messages';
import type { StreamState } from './chat-callbacks';
import type { ParserChainOutput } from './parser-chain';

export function applyParserOutput(state: StreamState, output: ParserChainOutput): StreamState {
	return {
		content: state.content + (output.text ?? ''),
		reasoning: output.thinking != null
			? (state.reasoning != null ? state.reasoning + output.thinking : output.thinking)
			: state.reasoning,
		gameData: output.gameData && isValidGameData(output.gameData) ? output.gameData : state.gameData,
		reviewScratchpad: output.reviewScratchpad ?? state.reviewScratchpad,
		revisedNarrative: output.revisedNarrative ?? state.revisedNarrative,
		revisedGameData: output.revisedGameData ?? state.revisedGameData,
	};
}

export function applyReasoningDelta(state: StreamState, text: string): StreamState {
	return {
		...state,
		reasoning: (state.reasoning ?? '') + text
	};
}

function isValidGameData(gameData: GameData): boolean {
	return gameData.worldState.trim().length > 0 && gameData.decisions.length > 0;
}
