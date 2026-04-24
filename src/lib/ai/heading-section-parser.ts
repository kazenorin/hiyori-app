import type { StreamParser } from './stream-parser';

type ParserState = 'TEXT' | 'POTENTIAL_OPENER' | 'SECTION_BODY';

export interface HeadingSectionOptions {
	/** When provided, store body content in accumulator[accumulatorKey] instead of discarding. */
	accumulatorKey?: string;
	/** When true, capture body until EOF (no heading boundary detection). Useful for last sections. */
	captureToEnd?: boolean;
	/** Heading level: 1 for H1 (#), 2 for H2 (##), etc. Default is 1. */
	level?: number;
}

/**
 * Creates a parser that hides an H1 heading section from text output.
 *
 * Detects `# {sectionHeading}`, buffers content until the next H1 heading
 * (a line starting with `# `), and hides the entire section from passthrough.
 *
 * When `options.accumulatorKey` is provided, the section body content is emitted
 * incrementally (as deltas) to `accumulator[accumulatorKey]`, enabling
 * real-time streaming. When omitted, the content is silently discarded.
 *
 * When `options.captureToEnd` is true, the section body captures until EOF/flush
 * instead of stopping at the next H1 heading. This is needed for sections that
 * contain fenced content (e.g., ```markdown blocks) with embedded H1 headings.
 */
export function createHeadingSectionParser(
	sectionHeading: string,
	options?: string | HeadingSectionOptions
): StreamParser<Record<string, unknown>> {
	const resolvedOptions = typeof options === 'string' ? { accumulatorKey: options } : (options ?? {});
	const accumulatorKey = resolvedOptions.accumulatorKey;
	const captureToEnd = resolvedOptions.captureToEnd ?? false;
	const level = resolvedOptions.level ?? 1;
	const OPENER = `${'#'.repeat(level)} ${sectionHeading}`;

	let state: ParserState = 'TEXT';
	let openerBuffer = '';
	let textBuffer = '';
	let lineStart = true; // Track whether we're at the start of a line
	let bodyBuffer = '';
	let emittedBodyLength = 0;

	function emitBodyDelta(accumulator: Record<string, unknown>): void {
		if (!accumulatorKey) return;
		const delta = bodyBuffer.slice(emittedBodyLength);
		if (delta) {
			emittedBodyLength = bodyBuffer.length;
			accumulator[accumulatorKey] = (accumulator[accumulatorKey] ?? '') + delta;
		}
	}

	function feed(chunk: string, accumulator: Record<string, unknown>): string {
		for (let i = 0; i < chunk.length; i++) {
			const char = chunk[i];

			switch (state) {
				case 'TEXT': {
					if (char === '#' && lineStart) {
						state = 'POTENTIAL_OPENER';
						openerBuffer = '#';
					} else {
						textBuffer += char;
					}
					lineStart = char === '\n';
					break;
				}

				case 'POTENTIAL_OPENER': {
					openerBuffer += char;

					if (openerBuffer === OPENER) {
						// Matched heading — enter section body
						state = 'SECTION_BODY';
						openerBuffer = '';
						bodyBuffer = '';
						emittedBodyLength = 0;
						lineStart = false;
					} else if (char === '\n' || (char !== ' ' && !OPENER.startsWith(openerBuffer))) {
						// Can't form opener — flush as text
						textBuffer += openerBuffer;
						openerBuffer = '';
						state = 'TEXT';
						lineStart = char === '\n';
						// Re-process this char in TEXT state if it's a '#' at line start
						if (char === '#' && lineStart) {
							state = 'POTENTIAL_OPENER';
							openerBuffer = '#';
						}
					}
					break;
				}

				case 'SECTION_BODY': {
					if (captureToEnd) {
						// Capture everything until EOF/flush — ignore H1 boundaries
						bodyBuffer += char;
					} else {
						// Detect next H1 heading: newline followed by `# `
						if (char === '\n') {
							lineStart = true;
							bodyBuffer += char;
						} else if (char === '#' && lineStart) {
							// Found start of next H1 heading — close section
							// Emit remaining body delta before closing
							emitBodyDelta(accumulator);
							emittedBodyLength = 0;
							bodyBuffer = '';
							state = 'TEXT';
							lineStart = true;
							// Re-process this '#' as potential opener or text
							openerBuffer = '#';
							state = 'POTENTIAL_OPENER';
						} else {
							bodyBuffer += char;
							lineStart = false;
						}
					}
					break;
				}
			}
		}

		// Emit text accumulated before the section (always, regardless of state)
		const text = textBuffer;
		textBuffer = '';

		// Emit body content delta while still buffering
		if (state !== 'TEXT') {
			emitBodyDelta(accumulator);
		}

		return text;
	}

	function flush(accumulator: Record<string, unknown>): string {
		let flushedText = textBuffer;

		switch (state) {
			case 'TEXT':
				break;
			case 'POTENTIAL_OPENER':
				flushedText += openerBuffer;
				openerBuffer = '';
				break;
			case 'SECTION_BODY':
				if (emittedBodyLength > 0) {
					// Content was already streamed — emit remaining delta, don't flush as text
					emitBodyDelta(accumulator);
				} else if (!accumulatorKey) {
					// No accumulator key — discard content
				} else {
					// Content was buffered but not emitted — passthrough as text
					flushedText += OPENER + bodyBuffer;
				}
				bodyBuffer = '';
				emittedBodyLength = 0;
				break;
		}

		state = 'TEXT';
		textBuffer = '';
		lineStart = true;

		return flushedText;
	}

	return { feed, flush };
}
