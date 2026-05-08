import { type NarrativeVariables, type GameDataFields } from './narrative-types';
import { type ParserChainOutput } from './parser-chain';
import type { StreamState } from './chat-callbacks';

export function mergeGameDataFields(existing: GameDataFields | null, incoming: GameDataFields | null): GameDataFields | null {
	if (!incoming) return existing;
	if (!existing) return incoming;
	return {
		activePlotThreads: [...existing.activePlotThreads, ...incoming.activePlotThreads],
		decisionContext: incoming.decisionContext ?? existing.decisionContext,
		decisions: [...existing.decisions, ...incoming.decisions],
	};
}

export function applyParserOutput(state: StreamState, output: ParserChainOutput): StreamState {
	return {
		content: state.content + (output.text ?? ''),
		reasoning: appendDelta(state.reasoning, output.thinking),
		variables: output.variables ?? state.variables,
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
