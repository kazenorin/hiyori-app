import type {StreamParser} from './stream-parser';

type ParserState = 'TEXT' | 'POTENTIAL_OPENER' | 'TAG_BODY' | 'POTENTIAL_CLOSER';

/**
 * Streaming character parser that extracts content between XML-style open/close tags.
 * The extracted content is hidden from text passthrough.
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
	let extractedAccumulator = '';

	function collectResult(accumulator: { [tagName]: string | null }): string {
		const text = textBuffer;
		const extracted = extractedAccumulator.length > 0 ? extractedAccumulator : null;
		textBuffer = '';
		extractedAccumulator = '';
		accumulator[tagName] = extracted ?? accumulator[tagName];
		return text;
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
							const trimmed = bodyBuffer.trim();
							if (trimmed) {
								extractedAccumulator += trimmed;
							}
							bodyBuffer = '';
							closerBuffer = '';
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
			return collectResult(accumulator);
		}

		// Emit extracted content while buffering
		if (extractedAccumulator) {
			const extracted = extractedAccumulator;
			extractedAccumulator = '';
			accumulator[tagName] = extracted;
		}

		return '';
	}

	function flush(accumulator: { [tagName]: string | null }): string {
		let flushedText = textBuffer;

		switch (state) {
			case 'TEXT':
				break;
			case 'POTENTIAL_OPENER':
				flushedText += openerBuffer;
				openerBuffer = '';
				break;
			case 'TAG_BODY':
				flushedText += savedOpener + bodyBuffer;
				bodyBuffer = '';
				savedOpener = '';
				break;
			case 'POTENTIAL_CLOSER':
				flushedText += savedOpener + bodyBuffer + closerBuffer;
				bodyBuffer = '';
				closerBuffer = '';
				savedOpener = '';
				break;
		}

		state = 'TEXT';
		textBuffer = '';

		accumulator[tagName] = extractedAccumulator.length > 0 ? accumulator[tagName] + extractedAccumulator : accumulator[tagName];
		extractedAccumulator = '';
		return flushedText;
	}

	return { feed, flush };
}
