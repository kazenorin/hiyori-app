import { marked, type Tokens } from 'marked';
import type { StreamParser } from './stream-parser';
import type { GameData } from '$lib/db/messages';

type ParserState = 'TEXT' | 'POTENTIAL_OPENER' | 'MARKDOWN_BODY';

const SECTION_OPENER = '# Game Data';

/**
 * Streaming parser that extracts Game Data from Markdown format.
 *
 * Detects `# Game Data` heading, buffers everything after it,
 * and parses the structure using marked.lexer() on flush.
 * Game data always appears at the end of the LLM response,
 * so the section boundary is EOF (flush).
 *
 * The extracted content is hidden from text passthrough.
 */
export function createMarkdownGameDataParser(tagName: string = 'gameData'): StreamParser<{ [key: string]: GameData | null }> {
	let state: ParserState = 'TEXT';
	let openerBuffer = '';
	let bodyBuffer = '';
	let textBuffer = '';

	function collectResult(_accumulator: Record<string, GameData | null>): string {
		const text = textBuffer;
		textBuffer = '';
		return text;
	}

	function parseGameDataFromMarkdown(markdown: string): GameData | null {
		const tokens = marked.lexer(markdown);

		const playerAliases: string[] = [];
		const aliases: Map<string, string[]> = new Map();
		let worldState = '';
		const decisions: string[] = [];
		let currentH2: string | null = null;
		let currentH3: string | null = null;

		for (const token of tokens) {
			if (token.type === 'heading') {
				const heading = token as Tokens.Heading;
				if (heading.depth === 1) {
					continue;
				} else if (heading.depth === 2) {
					currentH2 = heading.text.toLowerCase();
					currentH3 = null;
				} else if (heading.depth === 3 && currentH2 === 'other character aliases') {
					currentH3 = heading.text;
					if (currentH3 && !aliases.has(currentH3)) {
						aliases.set(currentH3, []);
					}
				}
			} else if (token.type === 'list') {
				const list = token as Tokens.List;
				if (currentH2 === 'player aliases') {
					for (const item of list.items) {
						playerAliases.push(item.text);
					}
				} else if (currentH2 === 'other character aliases' && currentH3) {
					const charAliases = aliases.get(currentH3);
					if (charAliases) {
						for (const item of list.items) {
							charAliases.push(item.text);
						}
					}
				} else if (currentH2 === 'decisions') {
					for (const item of list.items) {
						decisions.push(item.text);
					}
				}
			} else if (token.type === 'paragraph') {
				const para = token as Tokens.Paragraph;
				if (currentH2 === 'world state') {
					worldState = para.text;
				}
			}
		}

		if (!worldState || decisions.length === 0) {
			return null;
		}

		const result: GameData = { worldState, decisions };

		if (playerAliases.length > 0) {
			result.playerAliases = playerAliases;
		}

		if (aliases.size > 0) {
			result.aliases = Array.from(aliases.entries()).map(([name, als]) => [name, ...als]);
		}

		return result;
	}

	function feed(chunk: string, accumulator: Record<string, GameData | null>): string {
		for (let i = 0; i < chunk.length; i++) {
			const char = chunk[i];

			switch (state) {
				case 'TEXT': {
					if (char === '#') {
						state = 'POTENTIAL_OPENER';
						openerBuffer = '#';
					} else {
						textBuffer += char;
					}
					break;
				}

				case 'POTENTIAL_OPENER': {
					openerBuffer += char;

					if (openerBuffer === SECTION_OPENER) {
						state = 'MARKDOWN_BODY';
						bodyBuffer = '';
						openerBuffer = '';
					} else if (!SECTION_OPENER.startsWith(openerBuffer)) {
						textBuffer += openerBuffer;
						openerBuffer = '';
						state = 'TEXT';
					}
					break;
				}

				case 'MARKDOWN_BODY': {
					bodyBuffer += char;
					break;
				}
			}
		}

		if (state === 'TEXT') {
			return collectResult(accumulator);
		}

		return '';
	}

	function flush(accumulator: Record<string, GameData | null>): string {
		let flushedText = textBuffer;

		switch (state) {
			case 'TEXT':
				break;
			case 'POTENTIAL_OPENER':
				flushedText += openerBuffer;
				openerBuffer = '';
				break;
			case 'MARKDOWN_BODY': {
				const gameData = parseGameDataFromMarkdown(bodyBuffer);
				if (gameData) {
					accumulator[tagName] = gameData;
				} else {
					flushedText += SECTION_OPENER + bodyBuffer;
				}
				bodyBuffer = '';
				break;
			}
		}

		state = 'TEXT';
		textBuffer = '';

		return flushedText;
	}

	return { feed, flush };
}
