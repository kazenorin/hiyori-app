/**
 * Base result type for all streaming parsers.
 * Every parser produces text passthrough plus its own extracted fields.
 */
export type ParserAccumulator<TExtract> = { } & TExtract;

/**
 * Standard contract for streaming character parsers.
 *
 * Parsers receive raw text chunks via `feed()` and return whatever they
 * have extracted so far. Call `flush()` at end-of-stream to recover
 * any buffered content.
 *
 */
export interface StreamParser<TExtract> {
	feed(chunk: string, accumulator: ParserAccumulator<TExtract>): string;
	flush(accumulator: ParserAccumulator<TExtract>): string;
}
