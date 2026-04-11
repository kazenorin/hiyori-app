import type { GameData } from '$lib/db/messages';
import type { Message, MessageMetadata } from './chat.svelte';
import type { StreamState } from './chat-callbacks';
import type { ParserChainOutput } from './parser-chain';

export function appendReasoning(message: Message, text: string): Message {
	return {
		...message,
		reasoning: (message.reasoning ?? '') + text
	};
}

export function appendContent(message: Message, text: string): Message {
	return {
		...message,
		content: message.content + text
	};
}

export function setGameData(message: Message, gameData: GameData): Message {
	if (!isValidGameData(gameData)) return message;
	return {
		...message,
		gameData
	};
}

export function setMetadata(message: Message, reasoning: string | undefined, metadata: MessageMetadata): Message {
	return {
		...message,
		reasoning,
		metadata
	};
}

export function applyParserOutput(state: StreamState, output: ParserChainOutput): StreamState {
	return {
		content: state.content + (output.text ?? ''),
		reasoning: state.reasoning + (output.thinking ?? ''),
		gameData: output.gameData && isValidGameData(output.gameData) ? output.gameData : state.gameData
	};
}

export function applyReasoningDelta(state: StreamState, text: string): StreamState {
	return {
		...state,
		reasoning: state.reasoning + text
	};
}

function isValidGameData(gameData: GameData): boolean {
	return gameData.worldState.trim().length > 0 && gameData.decisions.length > 0;
}
