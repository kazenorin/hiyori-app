import type { GameData } from '$lib/db/messages';
import type { StreamParser } from './stream-parser';

type ParserState = 'TEXT' | 'POTENTIAL_OPENER' | 'JSON_BODY' | 'POTENTIAL_CLOSER';

const JSON_OPENER = '```json';
const JSON_CLOSER = '```';

export function createGameDataParser(): StreamParser<{ gameData: GameData | null }> {
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

	function collectResult(accumulator: { gameData: GameData | null }): string {
		const text = textBuffer;
		const gameData = pendingGameData;
		textBuffer = '';
		pendingGameData = null;
		accumulator.gameData = gameData ?? accumulator.gameData;
		return text;
	}

	function feed(chunk: string, accumulator: { gameData: GameData | null }): string {
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
			return collectResult(accumulator);
		}

		// While buffering, return game data if found (no text yet)
		if (pendingGameData) {
			const gameData = pendingGameData;
			pendingGameData = null;
			accumulator.gameData = gameData;
		}

		return '';
	}

	function flush(accumulator: { gameData: GameData | null }): string {
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

		accumulator.gameData = pendingGameData ?? accumulator.gameData
		pendingGameData = null;
		return flushedText;
	}

	return { feed, flush };
}
