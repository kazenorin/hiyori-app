/**
 * Base result type for all streaming parsers.
 * Every parser produces text passthrough plus its own extracted fields.
 */
export type ParserResult<TExtract> = { text: string | null } & TExtract;

/**
 * Standard contract for streaming character parsers.
 *
 * Parsers receive raw text chunks via `feed()` and return whatever they
 * have extracted so far. Call `flush()` at end-of-stream to recover
 * any buffered content.
 *
 * @typeParam TExtract - Parser-specific extracted fields
 *   (e.g. `{ thinking: string | null }` for the thinking-tag parser).
 */
export interface StreamParser<TExtract> {
	feed(chunk: string): ParserResult<TExtract>;
	flush(): ParserResult<TExtract>;
}
