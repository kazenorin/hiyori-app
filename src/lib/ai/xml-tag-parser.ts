import type {StreamParser} from './stream-parser';

type ParserState = 'TEXT' | 'POTENTIAL_OPENER' | 'TAG_BODY' | 'POTENTIAL_CLOSER';

/**
 * Streaming character parser that extracts content between XML-style open/close tags.
 * The extracted content is hidden from text passthrough.
 *
 * Body content is emitted incrementally (as deltas) while inside the tag,
 * enabling real-time streaming of tag content to the UI.
 */

export function createXmlTagParser(tagName: string): StreamParser<{ [tagName]: string | null }> {
	const OPENER = `<${tagName}`;
	const CLOSER = `</${tagName}>`;

	let state: ParserState = 'TEXT';
	let openerBuffer = '';
	let savedOpener = '';
	let bodyBuffer = '';
	let closerBuffer = '';
	let textBuffer = '';
	let emittedBodyLength = 0;

	function collectResult(): string {
		const text = textBuffer;
		textBuffer = '';
		return text;
	}

	function emitBodyDelta(accumulator: { [tagName]: string | null }): void {
		const delta = bodyBuffer.slice(emittedBodyLength);
		if (delta) {
			emittedBodyLength = bodyBuffer.length;
			accumulator[tagName] = (accumulator[tagName] ?? '') + delta;
		}
	}

	function feed(chunk: string, accumulator: { [tagName]: string | null }): string {
		for (let i = 0; i < chunk.length; i++) {
			const char = chunk[i];

			switch (state) {
				case 'TEXT': {
					if (char === '<') {
						state = 'POTENTIAL_OPENER';
						openerBuffer = '<';
					} else {
						textBuffer += char;
					}
					break;
				}

				case 'POTENTIAL_OPENER': {
					openerBuffer += char;

					if (char === '>') {
						if (openerBuffer.startsWith(OPENER)) {
							savedOpener = openerBuffer;
							state = 'TAG_BODY';
							bodyBuffer = '';
							emittedBodyLength = 0;
							openerBuffer = '';
						} else {
							textBuffer += openerBuffer;
							openerBuffer = '';
							state = 'TEXT';
						}
					} else if (
						!openerBuffer.startsWith(OPENER) &&
						!OPENER.startsWith(openerBuffer)
					) {
						textBuffer += openerBuffer;
						openerBuffer = '';
						state = 'TEXT';
					}
					break;
				}

				case 'TAG_BODY': {
					if (char === '<') {
						closerBuffer = '<';
						state = 'POTENTIAL_CLOSER';
					} else {
						bodyBuffer += char;
					}
					break;
				}

				case 'POTENTIAL_CLOSER': {
					closerBuffer += char;

					if (char === '>') {
						if (closerBuffer === CLOSER) {
							// Tag closed — emit remaining body delta
							emitBodyDelta(accumulator);
							bodyBuffer = '';
							closerBuffer = '';
							emittedBodyLength = 0;
							savedOpener = '';
							state = 'TEXT';
						} else {
							bodyBuffer += closerBuffer;
							closerBuffer = '';
							state = 'TAG_BODY';
						}
					} else if (!CLOSER.startsWith(closerBuffer)) {
						bodyBuffer += closerBuffer;
						closerBuffer = '';
						state = 'TAG_BODY';
					}
					break;
				}
			}
		}

		if (state === 'TEXT') {
			return collectResult();
		}

		// Emit body content delta while still buffering
		emitBodyDelta(accumulator);

		return '';
	}

	function flushBuffers(): string {
		let flushed = '';
		switch (state) {
			case 'TEXT':
				break;
			case 'POTENTIAL_OPENER':
				flushed += openerBuffer;
				openerBuffer = '';
				break;
			case 'TAG_BODY':
				flushed += savedOpener + bodyBuffer;
				bodyBuffer = '';
				savedOpener = '';
				break;
			case 'POTENTIAL_CLOSER':
				flushed += savedOpener + bodyBuffer + closerBuffer;
				bodyBuffer = '';
				closerBuffer = '';
				savedOpener = '';
				break;
		}
		return flushed;
	}

	function flush(accumulator: { [tagName]: string | null }): string {
		let flushedText = textBuffer;

		if (emittedBodyLength > 0) {
			// Content was already streamed — emit remaining delta, don't flush as text
			emitBodyDelta(accumulator);
			flushBuffers(); // discard buffered state
		} else {
			// Nothing was streamed — original flush behavior (passthrough text)
			flushedText += flushBuffers();
		}

		state = 'TEXT';
		textBuffer = '';
		emittedBodyLength = 0;

		return flushedText;
	}

	return { feed, flush };
}
