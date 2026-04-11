import type { GameData } from '$lib/db/messages';

export interface ParserOutput {
	text: string | null;
	gameData: GameData | null;
}

type ParserState = 'TEXT' | 'POTENTIAL_OPENER' | 'JSON_BODY' | 'POTENTIAL_CLOSER';

const JSON_OPENER = '```json';
const JSON_CLOSER = '```';

export interface GameDataStreamParser {
	feed(chunk: string): ParserOutput;
	flush(): ParserOutput;
}

export function createGameDataStreamParser(): GameDataStreamParser {
	let state: ParserState = 'TEXT';
	let openerBuffer = '';
	let jsonBuffer = '';
	let closerBuffer = '';
	let textBuffer = '';
	let pendingGameData: GameData | null = null;

	function tryParseGameData(json: string): GameData | null {
		try {
			const parsed = JSON.parse(json.trim());
			if (
				typeof parsed === 'object' &&
				parsed !== null &&
				typeof parsed.worldState === 'string' &&
				Array.isArray(parsed.decisions) &&
				parsed.decisions.every((d: unknown) => typeof d === 'string')
			) {
				return { worldState: parsed.worldState, decisions: parsed.decisions };
			}
		} catch {
			// Not valid JSON
		}
		return null;
	}

	function collectResult(): ParserOutput {
		const text = textBuffer.length > 0 ? textBuffer : null;
		const gameData = pendingGameData;
		textBuffer = '';
		pendingGameData = null;
		return { text, gameData };
	}

	function feed(chunk: string): ParserOutput {
		for (let i = 0; i < chunk.length; i++) {
			const char = chunk[i];

			switch (state) {
				case 'TEXT': {
					if (char === '`') {
						state = 'POTENTIAL_OPENER';
						openerBuffer = '`';
					} else {
						textBuffer += char;
					}
					break;
				}

				case 'POTENTIAL_OPENER': {
					openerBuffer += char;

					if (openerBuffer === JSON_OPENER) {
						// Confirmed ```json — transition to JSON body collection
						state = 'JSON_BODY';
						jsonBuffer = '';
						openerBuffer = '';
					} else if (!JSON_OPENER.startsWith(openerBuffer)) {
						// Buffer can no longer form ```json — flush as text
						textBuffer += openerBuffer;
						openerBuffer = '';
						state = 'TEXT';
					}
					break;
				}

				case 'JSON_BODY': {
					if (char === '`') {
						closerBuffer = '`';
						state = 'POTENTIAL_CLOSER';
					} else if (char === '\n' && jsonBuffer.length === 0) {
						// Skip leading newline after ```json
					} else {
						jsonBuffer += char;
					}
					break;
				}

				case 'POTENTIAL_CLOSER': {
					if (char === '`') {
						closerBuffer += '`';
						if (closerBuffer === JSON_CLOSER) {
							// Complete code block — try to parse as game data
							const gameData = tryParseGameData(jsonBuffer);
							if (gameData) {
								// Valid game data — store separately, don't add to text
								pendingGameData = gameData;
							} else {
								// Not game data — flush entire block as text
								textBuffer += JSON_OPENER + '\n' + jsonBuffer + JSON_CLOSER;
							}
							jsonBuffer = '';
							closerBuffer = '';
							state = 'TEXT';
						}
					} else {
						// Not a closing sequence — add buffered backticks + char to JSON body
						jsonBuffer += closerBuffer + char;
						closerBuffer = '';
						state = 'JSON_BODY';
					}
					break;
				}
			}
		}

		// Only return text if we're in TEXT state (not mid-buffer)
		if (state === 'TEXT') {
			return collectResult();
		}

		// While buffering, return game data if found (no text yet)
		if (pendingGameData) {
			const gameData = pendingGameData;
			pendingGameData = null;
			return { text: null, gameData };
		}

		return { text: null, gameData: null };
	}

	function flush(): ParserOutput {
		let flushedText = textBuffer;

		switch (state) {
			case 'TEXT':
				break;
			case 'POTENTIAL_OPENER':
				flushedText += openerBuffer;
				openerBuffer = '';
				break;
			case 'JSON_BODY':
				flushedText += JSON_OPENER + '\n' + jsonBuffer;
				jsonBuffer = '';
				break;
			case 'POTENTIAL_CLOSER':
				flushedText += JSON_OPENER + '\n' + jsonBuffer + closerBuffer;
				jsonBuffer = '';
				closerBuffer = '';
				break;
		}

		state = 'TEXT';
		textBuffer = '';

		const result: ParserOutput = {
			text: flushedText.length > 0 ? flushedText : null,
			gameData: pendingGameData
		};
		pendingGameData = null;
		return result;
	}

	return { feed, flush };
}
