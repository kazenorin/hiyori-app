import type { StreamCallbacks } from './streaming';
import type { ParserChainOutput } from './parser-chain';
import { createParserChain } from './parser-chain';
import { applyParserOutput, applyReasoningDelta } from './message-updater';
import type { GameData } from '$lib/db/messages';

export interface StreamState {
	content: string;
	reasoning: string;
	gameData: GameData | null;
}

export interface StreamAccumulator {
	callbacks: StreamCallbacks;
	state: StreamState;
	flush(): ParserChainOutput;
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
	let state: StreamState = {
		content: '',
		reasoning: '',
		gameData: null
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
			}
		},
		get state() {
			return state;
		},
		flush(): ParserChainOutput {
			const output = chain.flush();
			state = applyParserOutput(state, output);
			return output;
		}
	};
}