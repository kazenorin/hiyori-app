import type { StreamParser } from './stream-parser';

type ParserState = 'TEXT' | 'POTENTIAL_OPENER' | 'SECTION_BODY';

/**
 * Creates a parser that hides an H1 heading section from text output.
 *
 * Detects `# {sectionHeading}`, buffers content until the next H1 heading
 * (a line starting with `# `), and hides the entire section.
 * The content is discarded — not stored in the accumulator.
 */
export function createHeadingSectionParser(sectionHeading: string): StreamParser<Record<string, unknown>> {
	const OPENER = `# ${sectionHeading}`;

	let state: ParserState = 'TEXT';
	let openerBuffer = '';
	let textBuffer = '';
	let lineStart = true; // Track whether we're at the start of a line

	function feed(chunk: string, _accumulator: Record<string, unknown>): string {
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
						// Check next char is newline or EOF (not part of a longer heading like `# Scratchpad Notes`)
						state = 'SECTION_BODY';
						openerBuffer = '';
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
					// Detect next H1 heading: newline followed by `# `
					if (char === '\n') {
						lineStart = true;
					} else if (char === '#' && lineStart) {
						// Found start of next H1 heading — close section
						// Don't consume the `#`, let it be processed as TEXT
						state = 'TEXT';
						lineStart = true;
						// Re-process this '#' as potential opener or text
						openerBuffer = '#';
						state = 'POTENTIAL_OPENER';
					} else {
						lineStart = false;
					}
					break;
				}
			}
		}

		if (state === 'TEXT') {
			const text = textBuffer;
			textBuffer = '';
			return text;
		}

		return '';
	}

	function flush(_accumulator: Record<string, unknown>): string {
		let flushedText = textBuffer;

		switch (state) {
			case 'TEXT':
				break;
			case 'POTENTIAL_OPENER':
				flushedText += openerBuffer;
				openerBuffer = '';
				break;
			case 'SECTION_BODY':
				// Discard section body — it's hidden from output
				break;
		}

		state = 'TEXT';
		textBuffer = '';
		lineStart = true;

		return flushedText;
	}

	return { feed, flush };
}
