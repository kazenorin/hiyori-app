import type { StreamCallbacks, StreamResultMetadata } from './streaming';
import type { NarrativeVariables } from './narrative-types';
import type { OutputDescriptor } from '$lib/chat-stream-parser/types';
import { createParserChain, hasContent } from './parser-chain';
import { applyParserOutput, applyReasoningDelta } from './message-updater';
import { NARRATIVE_DESCRIPTORS } from './descriptors';

export interface StreamState {
	content: string;
	reasoning: string | null;
	variables: NarrativeVariables | null;
}

export interface StreamAccumulator {
	callbacks: StreamCallbacks;
	state: StreamState;
	resultMetadata: Promise<StreamResultMetadata>;
}

export type OnStreamUpdate = (state: StreamState) => void;
export type OnStreamError = (err: unknown) => void;

/**
 * Creates streaming callbacks that process text through the parser chain
 * (thinking tags → narrative stream parser) and accumulate state.
 *
 * @param onUpdate - called with the accumulated state after each delta
 * @param onError - called when a stream error occurs
 * @param descriptors - OutputDescriptor configurations for the pipeline phase.
 *                       Defaults to NARRATIVE_DESCRIPTORS (scene + game data).
 */
export function createStreamAccumulator(onUpdate?: OnStreamUpdate, onError?: OnStreamError, descriptors: OutputDescriptor[] = NARRATIVE_DESCRIPTORS): StreamAccumulator {
	const chain = createParserChain(descriptors);
	const { promise: resultMetadataPromise, resolve: resolveResult, reject: rejectResult } = Promise.withResolvers<StreamResultMetadata>();
	let state: StreamState = {
		content: '',
		reasoning: null,
		variables: null,
	};

	function notify(): void {
		if (onUpdate) onUpdate(state);
	}

	return {
		callbacks: {
			onTextDelta: (text: string) => {
				const output = chain.feed(text);
				if (hasContent(output)) {
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
				resolveResult(resultMetadata);
			},
			onError: (err: unknown) => {
				const chainOutput = chain.flush();
				state = applyParserOutput(state, chainOutput);
				notify();
				if (onError) onError(err);
				rejectResult(err);
			},
		},
		get state() {
			return state;
		},
		resultMetadata: resultMetadataPromise,
	};
}
