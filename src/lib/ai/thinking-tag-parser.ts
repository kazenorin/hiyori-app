export interface ThinkingParserOutput {
	text: string | null;
	thinking: string | null;
}

type ParserState = 'TEXT' | 'POTENTIAL_OPENER' | 'THINKING_BODY' | 'POTENTIAL_CLOSER';

const THINK_TAG_NAME = 'think';
const THINK_OPENER = '<' + THINK_TAG_NAME;
const THINK_CLOSER = `</${THINK_TAG_NAME}>`;

export interface ThinkingTagParser {
	feed(chunk: string): ThinkingParserOutput;
	flush(): ThinkingParserOutput;
}

export function createThinkingTagParser(): ThinkingTagParser {
	let state: ParserState = 'TEXT';
	let openerBuffer = '';
	let savedOpener = '';
	let thinkingBuffer = '';
	let closerBuffer = '';
	let textBuffer = '';
	let thinkingAccumulator = '';

	function collectResult(): ThinkingParserOutput {
		const text = textBuffer.length > 0 ? textBuffer : null;
		const thinking = thinkingAccumulator.length > 0 ? thinkingAccumulator : null;
		textBuffer = '';
		thinkingAccumulator = '';
		return { text, thinking };
	}

	function feed(chunk: string): ThinkingParserOutput {
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

					// Check if we've closed the tag
					if (char === '>') {
						if (openerBuffer.startsWith(THINK_OPENER)) {
							// Valid <think...> opener
							savedOpener = openerBuffer;
							state = 'THINKING_BODY';
							thinkingBuffer = '';
							openerBuffer = '';
						} else {
							// Some other tag like <div> — flush as text
							textBuffer += openerBuffer;
							openerBuffer = '';
							state = 'TEXT';
						}
					} else if (
						!openerBuffer.startsWith(THINK_OPENER) &&
						!THINK_OPENER.startsWith(openerBuffer)
					) {
						// Can no longer form `<think` — flush as text
						textBuffer += openerBuffer;
						openerBuffer = '';
						state = 'TEXT';
					}
					// Otherwise: still potentially forming `<think...` or buffering attributes
					break;
				}

				case 'THINKING_BODY': {
					if (char === '<') {
						closerBuffer = '<';
						state = 'POTENTIAL_CLOSER';
					} else {
						thinkingBuffer += char;
					}
					break;
				}

				case 'POTENTIAL_CLOSER': {
					closerBuffer += char;

					if (char === '>') {
						if (closerBuffer === THINK_CLOSER) {
							// Complete </think> — accumulate thinking content
							const trimmed = thinkingBuffer.trim();
							if (trimmed) {
								thinkingAccumulator += trimmed;
							}
							thinkingBuffer = '';
							closerBuffer = '';
							savedOpener = '';
							state = 'TEXT';
						} else {
							// < followed by something that isn't </think>
							thinkingBuffer += closerBuffer;
							closerBuffer = '';
							state = 'THINKING_BODY';
						}
					} else if (!THINK_CLOSER.startsWith(closerBuffer)) {
						// Not forming </think — put back into thinking buffer
						thinkingBuffer += closerBuffer;
						closerBuffer = '';
						state = 'THINKING_BODY';
					}
					// Otherwise: still forming </think...
					break;
				}
			}
		}

		if (state === 'TEXT') {
			return collectResult();
		}

		return { text: null, thinking: null };
	}

	function flush(): ThinkingParserOutput {
		let flushedText = textBuffer;

		switch (state) {
			case 'TEXT':
				break;
			case 'POTENTIAL_OPENER':
				flushedText += openerBuffer;
				openerBuffer = '';
				break;
			case 'THINKING_BODY':
				// Incomplete thinking block — flush opener + content as text
				flushedText += savedOpener + thinkingBuffer;
				thinkingBuffer = '';
				savedOpener = '';
				break;
			case 'POTENTIAL_CLOSER':
				// Incomplete closer — flush everything as text
				flushedText += savedOpener + thinkingBuffer + closerBuffer;
				thinkingBuffer = '';
				closerBuffer = '';
				savedOpener = '';
				break;
		}

		state = 'TEXT';
		textBuffer = '';

		const result: ThinkingParserOutput = {
			text: flushedText.length > 0 ? flushedText : null,
			thinking: thinkingAccumulator.length > 0 ? thinkingAccumulator : null
		};
		thinkingAccumulator = '';
		return result;
	}

	return { feed, flush };
}