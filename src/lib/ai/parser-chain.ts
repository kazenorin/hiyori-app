import { createNarrativeStreamParser } from './narrative-stream-parser';
import type { OutputDescriptor } from '$lib/utils/chat-stream-parser/types';
import type { NarrativeVariables } from './narrative-types';
import { getNarrativeDescriptors } from './descriptors';

// --- Parser chain ---

export interface ParserChainOutput {
	text: string | null;
	thinking: string | null;
	variables: NarrativeVariables | null;
	/** Unused in the new parser — kept for interface compatibility. */
	finalizedFields: Set<string>;
}

export function hasContent(output: ParserChainOutput): boolean {
	return !!(output.text || output.thinking || output.variables);
}

export interface ParserChain {
	feed(chunk: string): ParserChainOutput;
	flush(): ParserChainOutput;
}

/**
 * Create a parser chain that extracts thinking tags and narrative variables.
 *
 * Uses chat-stream-parser with throttled incremental parsing.
 * Each parseContent() call produces complete field values, so
 * variables replace (not merge) the previous state.
 *
 * @param descriptors - OutputDescriptor configurations for the pipeline phase.
 *                       Defaults to getNarrativeDescriptors() (scene + game data).
 */
export function createParserChain(descriptors: OutputDescriptor[] = getNarrativeDescriptors()): ParserChain {
	const parser = createNarrativeStreamParser(descriptors);

	return {
		feed(chunk: string): ParserChainOutput {
			return parser.feed(chunk);
		},
		flush(): ParserChainOutput {
			return parser.flush();
		},
	};
}
