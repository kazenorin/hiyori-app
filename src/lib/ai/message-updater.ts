import {
	type NarrativeVariables,
	type GameDataFields,
	emptyVariables,
	NARRATIVE_VARIABLE_FIELDS,
	setField
} from './narrative-types';
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

function mergeVariables(existing: NarrativeVariables | null, incoming: NarrativeVariables | null): NarrativeVariables | null {
	if (!incoming) return existing;
	if (!existing) return incoming;
	const result = emptyVariables();
	for (const field of NARRATIVE_VARIABLE_FIELDS) {
		const e = existing[field];
		const i = incoming[field];
		if (typeof e === 'string' && typeof i === 'string') {
			setField(result, field, e + i);
		} else if (Array.isArray(e) && Array.isArray(i)) {
			setField(result, field, [...e, ...i]);
		} else if (Array.isArray(i)) {
			setField(result, field, i);
		} else if (Array.isArray(e)) {
			setField(result, field, e);
		} else {
			const val = (i ?? e) as string | null;
			if (val !== null) setField(result, field, val);
		}
	}
	result.gameData = mergeGameDataFields(existing.gameData, incoming.gameData);
	return result;
}

export function applyParserOutput(state: StreamState, output: ParserChainOutput): StreamState {
	return {
		content: state.content + (output.text ?? ''),
		reasoning: appendDelta(state.reasoning, output.thinking),
		variables: mergeVariables(state.variables, output.variables),
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