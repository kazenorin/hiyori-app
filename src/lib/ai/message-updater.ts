import { type NarrativeVariables, type GameDataFields, emptyVariables, NARRATIVE_VARIABLE_FIELDS, setField } from './parser-chain';
import type { StreamState } from './chat-callbacks';

function mergeCharacterAliases(existing: Record<string, string[]>, incoming: Record<string, string[]>): Record<string, string[]> {
	const result: Record<string, string[]> = { ...existing };
	for (const [key, aliases] of Object.entries(incoming)) {
		result[key] = [...(result[key] ?? []), ...aliases];
	}
	return result;
}

export function mergeGameDataFields(existing: GameDataFields | null, incoming: GameDataFields | null): GameDataFields | null {
	if (!incoming) return existing;
	if (!existing) return incoming;
	return {
		worldState:
			existing.worldState && incoming.worldState ? existing.worldState + incoming.worldState : (incoming.worldState ?? existing.worldState),
		decisions: [...existing.decisions, ...incoming.decisions],
		playerAliases: [...existing.playerAliases, ...incoming.playerAliases],
		otherCharacterAliases: mergeCharacterAliases(existing.otherCharacterAliases, incoming.otherCharacterAliases),
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
			const val = (i ?? e) as string | number | null;
			if (val !== null) setField(result, field, val);
		}
	}
	result.gameData = mergeGameDataFields(existing.gameData, incoming.gameData);
	return result;
}

export function applyParserOutput(state: StreamState, output: import('./parser-chain').ParserChainOutput): StreamState {
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
