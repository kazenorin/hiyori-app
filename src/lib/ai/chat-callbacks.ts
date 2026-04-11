import type { StreamCallbacks, StreamResultMetadata } from './streaming';
import { createParserChain } from './parser-chain';
import { applyParserOutput, applyReasoningDelta } from './message-updater';
import type { GameData } from '$lib/db/messages';

export interface StreamState {
	content: string;
	reasoning: string | null;
	gameData: GameData | null;
}

export interface StreamAccumulator {
	callbacks: StreamCallbacks;
	state: StreamState;
	resultMetadata: Promise<StreamResultMetadata>;
}

export type OnStreamUpdate = (state: StreamState) => void;

/**
 * Creates streaming callbacks that process text through the parser chain
 * (thinking tags → game-data blocks) and accumulate state.
 *
 * @param onUpdate - called with the accumulated state after each delta
 */
export function createStreamAccumulator(onUpdate?: OnStreamUpdate): StreamAccumulator {
	const chain = createParserChain();
	const { promise: resultMetadataPromise, resolve: resolveResult, reject: rejectResult } = Promise.withResolvers<StreamResultMetadata>()
	let state: StreamState = {
		content: '',
		reasoning: null,
		gameData: null,
	};

	function notify(): void {
		if (onUpdate) onUpdate(state);
	}

	return {
		callbacks: {
			onTextDelta: (text: string) => {
				const output = chain.feed(text);
				if (output.text || output.thinking || output.gameData) {
					state = applyParserOutput(state, output);
					notify();
				}
			},
			onReasoningDelta: (text: string) => {
				state = applyReasoningDelta(state, text);
				notify();
			},
			onComplete: (resultMetadata: StreamResultMetadata) => {
				const chainOutput = chain.flush();
				state = applyParserOutput(state, chainOutput);
				notify();
				resolveResult(resultMetadata)
			},
			onError: (err: unknown) => {
				rejectResult(err)
			}
		},
		get state() {
			return state;
		},
		resultMetadata: resultMetadataPromise
	};
}