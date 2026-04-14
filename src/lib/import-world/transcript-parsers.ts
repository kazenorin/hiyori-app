// Transcript parsers for multiple JSON formats

import type { GameData } from '$lib/db/messages';
import type {
	TranscriptFormat,
	ParsedTranscript,
	ParsedMessage,
	OpenWebUIExport,
	OpenWebUIMessage
} from './types';

// === Format Detection ===

export function detectTranscriptFormat(json: unknown): TranscriptFormat {
	if (!json || typeof json !== 'object') {
		return 'unknown';
	}

	// Check for App Export format: { messages: [...] }
	if (
		'messages' in json &&
		Array.isArray((json as Record<string, unknown>).messages)
	) {
		const msgs = (json as Record<string, unknown>).messages as unknown[];
		if (msgs.length > 0 && isAppExportMessage(msgs[0])) {
			return 'app-export';
		}
		if (msgs.length > 0 && isOpenAIMessage(msgs[0])) {
			return 'openai-api';
		}
	}

	// Check for Open WebUI format: array with chat.history.messages
	if (Array.isArray(json) && json.length > 0) {
		const first = json[0] as Record<string, unknown>;
		if (
			typeof first.title === 'string' &&
			first.chat &&
			typeof first.chat === 'object' &&
			first.chat !== null &&
			(first.chat as Record<string, unknown>).history &&
			typeof (first.chat as Record<string, unknown>).history === 'object'
		) {
			return 'openwebui';
		}
	}

	return 'unknown';
}

function isAppExportMessage(msg: unknown): boolean {
	if (!msg || typeof msg !== 'object') return false;
	const m = msg as Record<string, unknown>;
	return (
		typeof m.role === 'string' &&
		typeof m.content === 'string' &&
		('metadata' in m || 'game_data' in m || 'reasoning' in m)
	);
}

function isOpenAIMessage(msg: unknown): boolean {
	if (!msg || typeof msg !== 'object') return false;
	const m = msg as Record<string, unknown>;
	return typeof m.role === 'string' && typeof m.content === 'string' && !('game_data' in m);
}

// === Format A: App Export Format ===

export interface AppExportFormat {
	messages: AppExportMessage[];
}

export interface AppExportMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	reasoning?: string;
	metadata?: string;
	game_data?: string;
}

export function parseAppExportFormat(
	json: unknown,
	skipOptionalMalformed: boolean
): ParsedTranscript {
	if (!isAppExportFormat(json)) {
		throw new Error('Invalid App Export format');
	}

	const { messages } = json as AppExportFormat;
	const parsed: ParsedMessage[] = [];

	for (const msg of messages) {
		if (!isValidRole(msg.role)) continue;

		const parsedMsg: ParsedMessage = {
			role: msg.role,
			content: msg.content
		};

		if (msg.reasoning) {
			parsedMsg.reasoning = msg.reasoning;
		}

		if (msg.metadata) {
			const metadata = safeParseJson(msg.metadata);
			if (metadata !== null || !skipOptionalMalformed) {
				parsedMsg.metadata = msg.metadata;
			}
		}

		if (msg.game_data) {
			const gameData = parseGameData(msg.game_data, skipOptionalMalformed);
			if (gameData !== null) {
				parsedMsg.gameData = gameData;
			}
		}

		parsed.push(parsedMsg);
	}

	return { format: 'app-export', messages: parsed };
}

function isAppExportFormat(json: unknown): boolean {
	if (!json || typeof json !== 'object') return false;
	const obj = json as Record<string, unknown>;
	if (!Array.isArray(obj.messages)) return false;
	if (obj.messages.length === 0) return true; // Empty array is valid
	const first = obj.messages[0];
	return (
		first &&
		typeof first === 'object' &&
		typeof (first as Record<string, unknown>).role === 'string' &&
		typeof (first as Record<string, unknown>).content === 'string'
	);
}

// === Format B: Simple OpenAI API Format ===

export interface SimpleOpenAIFormat {
	messages: SimpleOpenAIMessage[];
}

export interface SimpleOpenAIMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	reasoning?: string;
	reasoning_content?: string;
	metadata?: string;
}

export function parseSimpleOpenAIFormat(json: unknown): ParsedTranscript {
	if (!isSimpleOpenAIFormat(json)) {
		throw new Error('Invalid Simple OpenAI API format');
	}

	const { messages } = json as SimpleOpenAIFormat;
	const parsed: ParsedMessage[] = [];

	for (const msg of messages) {
		if (!isValidRole(msg.role)) continue;

		const parsedMsg: ParsedMessage = {
			role: msg.role,
			content: msg.content
		};

		// Support both reasoning and reasoning_content
		if (msg.reasoning) {
			parsedMsg.reasoning = msg.reasoning;
		} else if (msg.reasoning_content) {
			parsedMsg.reasoning = msg.reasoning_content;
		}

		if (msg.metadata) {
			parsedMsg.metadata = msg.metadata;
		}

		parsed.push(parsedMsg);
	}

	return { format: 'openai-api', messages: parsed };
}

function isSimpleOpenAIFormat(json: unknown): boolean {
	if (!json || typeof json !== 'object') return false;
	const obj = json as Record<string, unknown>;
	if (!Array.isArray(obj.messages)) return false;
	if (obj.messages.length === 0) return true;
	const first = obj.messages[0];
	return (
		first &&
		typeof first === 'object' &&
		typeof (first as Record<string, unknown>).role === 'string' &&
		typeof (first as Record<string, unknown>).content === 'string'
	);
}

// === Format C: Open WebUI Format ===

export function parseOpenWebUIFormat(
	json: unknown,
	skipOptionalMalformed: boolean
): ParsedTranscript {
	if (!isOpenWebUIFormat(json)) {
		throw new Error('Invalid Open WebUI format');
	}

	const exports = json as OpenWebUIExport[];
	if (exports.length === 0) {
		throw new Error('Open WebUI export is empty');
	}

	// Use first item only per spec
	const first = exports[0];
	const messagesMap = first.chat.history.messages;

	// Build id -> message lookup
	const idToMessage = new Map<string, OpenWebUIMessage>();
	for (const key of Object.keys(messagesMap)) {
		idToMessage.set(key, messagesMap[key]);
	}

	// Find sequence heads (messages with no parent)
	const heads: OpenWebUIMessage[] = [];
	for (const msg of idToMessage.values()) {
		if (!msg.parentId) {
			heads.push(msg);
		}
	}

	// Build longest sequence via depth-first traversal
	let longestSequence: OpenWebUIMessage[] = [];
	for (const head of heads) {
		const sequence = buildSequence(head, idToMessage);
		if (sequence.length > longestSequence.length) {
			longestSequence = sequence;
		}
	}

	// Convert to ParsedMessage format
	const parsed: ParsedMessage[] = longestSequence.map((msg) =>
		convertOpenWebUIMessage(msg, skipOptionalMalformed)
	);

	return { format: 'openwebui', messages: parsed };
}

function isOpenWebUIFormat(json: unknown): boolean {
	if (!Array.isArray(json) || json.length === 0) return false;
	const first = json[0] as Record<string, unknown>;
	const chat = first.chat as Record<string, unknown> | undefined;
	return (
		typeof first.title === 'string' &&
		chat !== null && chat !== undefined &&
		typeof chat === 'object' &&
		chat.history !== null && chat.history !== undefined &&
		typeof chat.history === 'object'
	);
}

function buildSequence(
	head: OpenWebUIMessage,
	idToMessage: Map<string, OpenWebUIMessage>
): OpenWebUIMessage[] {
	const sequence: OpenWebUIMessage[] = [head];
	const visited = new Set<string>([head.id]);
	let current = head;

	while (current.childrenIds && current.childrenIds.length > 0) {
		// For depth-first, take first child
		const childId = current.childrenIds[0];
		// Cycle detection: stop if we've already visited this ID
		if (visited.has(childId)) break;
		const child = idToMessage.get(childId);
		if (!child) break;

		visited.add(childId);
		sequence.push(child);
		current = child;
	}

	return sequence;
}

function convertOpenWebUIMessage(
	msg: OpenWebUIMessage,
	skipOptionalMalformed: boolean
): ParsedMessage {
	const parsed: ParsedMessage = {
		role: msg.role,
		content: msg.content
	};

	if (msg.output && msg.output.length > 0) {
		// Extract main content and reasoning from output
		let mainContent = '';
		let reasoningContent = '';
		const metadata: Record<string, unknown> = {};

		for (const output of msg.output) {
			if (output.type === 'message' && output.content) {
				for (const content of output.content) {
					if (content.type === 'output_text' && content.text) {
						mainContent += content.text;
					}
				}
			} else if (output.type === 'reasoning' && output.content) {
				for (const content of output.content) {
					if (content.type === 'output_text' && content.text) {
						reasoningContent += content.text;
					}
				}
			}
		}

		if (mainContent) {
			parsed.content = mainContent;
		}
		if (reasoningContent) {
			parsed.reasoning = reasoningContent;
		}

		if (msg.usage) {
			metadata.usage = msg.usage;
			parsed.metadata = JSON.stringify(metadata);
		}
	}

	return parsed;
}

// === Utility Functions ===

function isValidRole(role: string): boolean {
	return role === 'user' || role === 'assistant' || role === 'system';
}

function safeParseJson(json: string): unknown | null {
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}

function parseGameData(raw: string, skipOptionalMalformed: boolean): GameData | null {
	try {
		const parsed = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === 'object' &&
			typeof parsed.worldState === 'string' &&
			Array.isArray(parsed.decisions) &&
			parsed.decisions.every((d: unknown) => typeof d === 'string')
		) {
			return { worldState: parsed.worldState, decisions: parsed.decisions };
		}
		return null;
	} catch {
		if (!skipOptionalMalformed) {
			throw new Error('Failed to parse game_data');
		}
		return null;
	}
}

// === Main Parse Entry Point ===

export async function parseTranscriptFile(
	file: File,
	skipOptionalMalformed: boolean
): Promise<ParsedTranscript> {
	const text = await file.text();
	let json: unknown;

	try {
		json = JSON.parse(text);
	} catch (e) {
		throw new Error('File is not valid JSON');
	}

	const format = detectTranscriptFormat(json);

	switch (format) {
		case 'app-export':
			return parseAppExportFormat(json, skipOptionalMalformed);
		case 'openai-api':
			return parseSimpleOpenAIFormat(json);
		case 'openwebui':
			return parseOpenWebUIFormat(json, skipOptionalMalformed);
		case 'unknown':
		default:
			throw new Error('Unable to detect transcript format');
	}
}
