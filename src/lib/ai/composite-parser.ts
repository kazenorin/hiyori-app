import type { StreamParser } from './stream-parser';

/**
 * A parser that chains multiple sub-parsers in sequence.
 * Each parser's text output feeds into the next parser.
 * All parsers share the same accumulator.
 */
export type CompositeParser = StreamParser<Record<string, unknown>>;

export function createCompositeParser(parsers: StreamParser<Record<string, unknown>>[]): CompositeParser {
	return {
		feed(chunk: string, accumulator: any): string {
			return parsers.reduce((text, parser) => parser.feed(text, accumulator), chunk);
		},

		flush(accumulator: any): string {
			const [first, ...rest] = parsers;
			let text = first.flush(accumulator);

			text = rest.reduce((t, parser) => parser.feed(t, accumulator), text);
			for (const parser of rest) {
				const flushed = parser.flush(accumulator);
				if (flushed) text += flushed;
			}

			return text;
		},
	};
}
