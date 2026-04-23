import type { StreamParser } from './stream-parser';

/**
 * Creates a parser that pipes content from an accumulator property through a nested parser.
 * Useful for processing content written by one parser through another parser
 * (e.g., extracting ```json blocks from within XML tag body content).
 *
 * The primaryParser writes to `acc[accumulatorPropertyKey]` (e.g., tag body deltas).
 * The nestedParser processes those values, writing its own outputs to `acc`.
 * The nestedParser's text output replaces the raw value in `acc[accumulatorPropertyKey]`.
 */
export function createNestedParser(
	accumulatorPropertyKey: string,
	primaryParser: StreamParser<Record<string, unknown>>,
	nestedParser: StreamParser<Record<string, unknown>>
): StreamParser<Record<string, unknown>> {
	function processNestedOutput(accumulator: Record<string, unknown>): void {
		// acc is fresh each chunk, so acc[accumulatorPropertyKey] is just this chunk's raw value
		const rawValue = accumulator[accumulatorPropertyKey] as string | undefined;
		if (rawValue) {
			const cleanedValue = nestedParser.feed(rawValue, accumulator);
			// Output just the cleaned value
			accumulator[accumulatorPropertyKey] = cleanedValue;
		}
	}

	return {
		feed(chunk: string, accumulator: Record<string, unknown>): string {
			const text = primaryParser.feed(chunk, accumulator);
			processNestedOutput(accumulator);
			return text;
		},

		flush(accumulator: Record<string, unknown>): string {
			const text = primaryParser.flush(accumulator);
			processNestedOutput(accumulator);
			const flushed = nestedParser.flush(accumulator);
			if (flushed) {
				accumulator[accumulatorPropertyKey] = flushed;
			}
			return text;
		},
	};
}
