import type { ParserResult, StreamParser } from './stream-parser';

type ParserState = 'TEXT' | 'POTENTIAL_OPENER' | 'TAG_BODY' | 'POTENTIAL_CLOSER';

/**
 * Streaming character parser that extracts content between XML-style open/close tags.
 * The extracted content is hidden from text passthrough.
 */
export interface XmlTagParser extends StreamParser<{ extracted: string | null }> {
}

export function createXmlTagParser(tagName: string): XmlTagParser {
	const OPENER = `<${tagName}`;
	const CLOSER = `</${tagName}>`;

	let state: ParserState = 'TEXT';
	let openerBuffer = '';
	let savedOpener = '';
	let bodyBuffer = '';
	let closerBuffer = '';
	let textBuffer = '';
	let extractedAccumulator = '';

	function collectResult(): ParserResult<{ extracted: string | null }> {
		const text = textBuffer.length > 0 ? textBuffer : null;
		const extracted = extractedAccumulator.length > 0 ? extractedAccumulator : null;
		textBuffer = '';
		extractedAccumulator = '';
		return { text, extracted };
	}

	function feed(chunk: string): ParserResult<{ extracted: string | null }> {
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
			return collectResult();
		}

		// Emit extracted content while buffering
		if (extractedAccumulator) {
			const extracted = extractedAccumulator;
			extractedAccumulator = '';
			return { text: null, extracted };
		}

		return { text: null, extracted: null };
	}

	function flush(): ParserResult<{ extracted: string | null }> {
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

		const result: ParserResult<{ extracted: string | null }> = {
			text: flushedText.length > 0 ? flushedText : null,
			extracted: extractedAccumulator.length > 0 ? extractedAccumulator : null
		};
		extractedAccumulator = '';
		return result;
	}

	return { feed, flush };
}
