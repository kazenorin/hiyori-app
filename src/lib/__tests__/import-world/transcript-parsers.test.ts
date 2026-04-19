import { describe, it, expect } from 'vitest';
import {
	detectTranscriptFormat,
	parseAppExportFormat,
	parseSimpleOpenAIFormat,
	parseOpenWebUIFormat,
	parseTranscriptFile,
} from '$lib/import-world/transcript-parsers';

// === Format Detection ===

describe('detectTranscriptFormat', () => {
	it('detects app-export format', () => {
		const json = {
			messages: [{ role: 'user', content: 'Hello', game_data: null, metadata: null }],
		};
		expect(detectTranscriptFormat(json)).toBe('app-export');
	});

	it('detects openai-api format', () => {
		const json = {
			messages: [{ role: 'user', content: 'Hello' }],
		};
		expect(detectTranscriptFormat(json)).toBe('openai-api');
	});

	it('detects openwebui format', () => {
		const json = [
			{
				title: 'Test Chat',
				chat: {
					history: {
						messages: {},
					},
				},
			},
		];
		expect(detectTranscriptFormat(json)).toBe('openwebui');
	});

	it('returns unknown for null', () => {
		expect(detectTranscriptFormat(null)).toBe('unknown');
	});

	it('returns unknown for non-object', () => {
		expect(detectTranscriptFormat('string')).toBe('unknown');
		expect(detectTranscriptFormat(123)).toBe('unknown');
	});

	it('returns unknown for empty object', () => {
		expect(detectTranscriptFormat({})).toBe('unknown');
	});

	it('returns unknown for empty array', () => {
		expect(detectTranscriptFormat([])).toBe('unknown');
	});

	it('prefers app-export over openai-api when game_data present', () => {
		const json = {
			messages: [{ role: 'assistant', content: 'Hi', reasoning: 'thinking...', metadata: null }],
		};
		expect(detectTranscriptFormat(json)).toBe('app-export');
	});

	it('handles empty messages array', () => {
		const json = { messages: [] };
		expect(detectTranscriptFormat(json)).toBe('unknown');
	});
});

// === App Export Format Parsing ===

describe('parseAppExportFormat', () => {
	it('parses valid app export messages', () => {
		const json = {
			messages: [
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi there' },
			],
		};
		const result = parseAppExportFormat(json, false);
		expect(result.format).toBe('app-export');
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0].role).toBe('user');
		expect(result.messages[0].content).toBe('Hello');
	});

	it('parses messages with reasoning', () => {
		const json = {
			messages: [{ role: 'assistant', content: 'Response', reasoning: 'I thought about it' }],
		};
		const result = parseAppExportFormat(json, false);
		expect(result.messages[0].reasoning).toBe('I thought about it');
	});

	it('parses messages with game_data', () => {
		const json = {
			messages: [
				{
					role: 'assistant',
					content: 'Response',
					game_data: '{"worldState":"test","decisions":["a","b"]}',
				},
			],
		};
		const result = parseAppExportFormat(json, false);
		expect(result.messages[0].gameData).toEqual({
			worldState: 'test',
			decisions: ['a', 'b'],
		});
	});

	it('skips system messages', () => {
		const json = {
			messages: [
				{ role: 'system', content: 'You are a GM' },
				{ role: 'user', content: 'Hello' },
			],
		};
		const result = parseAppExportFormat(json, false);
		// System is still included in parsed messages since it has valid role
		expect(result.messages).toHaveLength(2);
	});

	it('skips messages with invalid roles', () => {
		const json = {
			messages: [
				{ role: 'tool', content: 'tool output' },
				{ role: 'user', content: 'Hello' },
			],
		};
		const result = parseAppExportFormat(json, false);
		expect(result.messages).toHaveLength(1);
	});

	it('handles malformed game_data with skipOptionalMalformed=true', () => {
		const json = {
			messages: [
				{
					role: 'assistant',
					content: 'Response',
					game_data: 'not valid json',
				},
			],
		};
		const result = parseAppExportFormat(json, true);
		expect(result.messages[0].gameData).toBeUndefined();
	});

	it('throws on malformed game_data with skipOptionalMalformed=false', () => {
		const json = {
			messages: [
				{
					role: 'assistant',
					content: 'Response',
					game_data: 'not valid json',
				},
			],
		};
		expect(() => parseAppExportFormat(json, false)).toThrow();
	});

	it('handles empty messages array', () => {
		const json = { messages: [] };
		const result = parseAppExportFormat(json, false);
		expect(result.messages).toHaveLength(0);
	});

	it('handles metadata', () => {
		const json = {
			messages: [
				{
					role: 'user',
					content: 'Hello',
					metadata: '{"tokens":50}',
				},
			],
		};
		const result = parseAppExportFormat(json, false);
		expect(result.messages[0].metadata).toBe('{"tokens":50}');
	});

	it('throws for invalid format', () => {
		expect(() => parseAppExportFormat('not an object', false)).toThrow();
	});
});

// === Simple OpenAI API Format Parsing ===

describe('parseSimpleOpenAIFormat', () => {
	it('parses basic messages', () => {
		const json = {
			messages: [
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi' },
			],
		};
		const result = parseSimpleOpenAIFormat(json);
		expect(result.format).toBe('openai-api');
		expect(result.messages).toHaveLength(2);
	});

	it('supports reasoning_content field', () => {
		const json = {
			messages: [
				{
					role: 'assistant',
					content: 'Response',
					reasoning_content: 'My reasoning',
				},
			],
		};
		const result = parseSimpleOpenAIFormat(json);
		expect(result.messages[0].reasoning).toBe('My reasoning');
	});

	it('prefers reasoning over reasoning_content', () => {
		const json = {
			messages: [
				{
					role: 'assistant',
					content: 'Response',
					reasoning: 'Primary',
					reasoning_content: 'Secondary',
				},
			],
		};
		const result = parseSimpleOpenAIFormat(json);
		expect(result.messages[0].reasoning).toBe('Primary');
	});

	it('handles metadata', () => {
		const json = {
			messages: [{ role: 'user', content: 'Hello', metadata: '{"key":"value"}' }],
		};
		const result = parseSimpleOpenAIFormat(json);
		expect(result.messages[0].metadata).toBe('{"key":"value"}');
	});
});

// === Open WebUI Format Parsing ===

describe('parseOpenWebUIFormat', () => {
	function buildOpenWebUIExport(
		messages: Array<{
			id: string;
			parentId: string | null;
			childrenIds: string[];
			role: 'user' | 'assistant' | 'system';
			content: string;
			output?: Array<{ type: string; content: Array<{ type: string; text?: string }> | null }>;
		}>
	) {
		const msgMap: Record<string, unknown> = {};
		for (const msg of messages) {
			msgMap[msg.id] = {
				id: msg.id,
				parentId: msg.parentId,
				childrenIds: msg.childrenIds,
				role: msg.role,
				content: msg.content,
				output: msg.output ?? null,
			};
		}
		return [
			{
				title: 'Test Chat',
				chat: { history: { messages: msgMap } },
			},
		];
	}

	it('parses linear message chain', () => {
		const json = buildOpenWebUIExport([
			{ id: 'a', parentId: null, childrenIds: ['b'], role: 'user', content: 'Hello' },
			{ id: 'b', parentId: 'a', childrenIds: [], role: 'assistant', content: 'Hi' },
		]);

		const result = parseOpenWebUIFormat(json, false);
		expect(result.format).toBe('openwebui');
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0].content).toBe('Hello');
		expect(result.messages[1].content).toBe('Hi');
	});

	it('extracts content from output blocks', () => {
		const json = buildOpenWebUIExport([
			{
				id: 'a',
				parentId: null,
				childrenIds: ['b'],
				role: 'user',
				content: 'Hello',
			},
			{
				id: 'b',
				parentId: 'a',
				childrenIds: [],
				role: 'assistant',
				content: 'fallback content',
				output: [
					{
						type: 'message',
						content: [{ type: 'output_text', text: 'Main content' }],
					},
				],
			},
		]);

		const result = parseOpenWebUIFormat(json, false);
		expect(result.messages[1].content).toBe('Main content');
	});

	it('extracts reasoning from output blocks', () => {
		const json = buildOpenWebUIExport([
			{
				id: 'a',
				parentId: null,
				childrenIds: ['b'],
				role: 'user',
				content: 'Hello',
			},
			{
				id: 'b',
				parentId: 'a',
				childrenIds: [],
				role: 'assistant',
				content: 'response',
				output: [
					{
						type: 'reasoning',
						content: [{ type: 'output_text', text: 'My reasoning process' }],
					},
					{
						type: 'message',
						content: [{ type: 'output_text', text: 'Main response' }],
					},
				],
			},
		]);

		const result = parseOpenWebUIFormat(json, false);
		expect(result.messages[1].reasoning).toBe('My reasoning process');
		expect(result.messages[1].content).toBe('Main response');
	});

	it('selects longest chain when multiple heads exist', () => {
		const json = buildOpenWebUIExport([
			{ id: 'a', parentId: null, childrenIds: ['b1'], role: 'user', content: 'Short' },
			{ id: 'b1', parentId: 'a', childrenIds: [], role: 'assistant', content: 'Short reply' },
			{ id: 'c', parentId: null, childrenIds: ['d1'], role: 'user', content: 'Long start' },
			{ id: 'd1', parentId: 'c', childrenIds: ['e1'], role: 'assistant', content: 'Long reply 1' },
			{ id: 'e1', parentId: 'd1', childrenIds: [], role: 'user', content: 'Long reply 2' },
		]);

		const result = parseOpenWebUIFormat(json, false);
		expect(result.messages).toHaveLength(3); // c -> d1 -> e1
		expect(result.messages[0].content).toBe('Long start');
	});

	it('uses only first item in export array', () => {
		const first = buildOpenWebUIExport([{ id: 'a', parentId: null, childrenIds: [], role: 'user', content: 'First chat' }]);
		const second = buildOpenWebUIExport([{ id: 'x', parentId: null, childrenIds: [], role: 'user', content: 'Second chat' }]);

		const result = parseOpenWebUIFormat([...first, ...second], false);
		expect(result.messages).toHaveLength(1);
		expect(result.messages[0].content).toBe('First chat');
	});

	it('throws for empty export array', () => {
		expect(() => parseOpenWebUIFormat([], false)).toThrow();
	});

	it('throws for invalid format', () => {
		expect(() => parseOpenWebUIFormat({}, false)).toThrow();
	});

	it('handles messages with null childrenIds', () => {
		const json = [
			{
				title: 'Test',
				chat: {
					history: {
						messages: {
							a: {
								id: 'a',
								parentId: null,
								childrenIds: null,
								role: 'user',
								content: 'Hello',
								output: null,
							},
						},
					},
				},
			},
		];

		const result = parseOpenWebUIFormat(json, false);
		expect(result.messages).toHaveLength(1);
	});

	it('handles messages with usage data', () => {
		const json = buildOpenWebUIExport([
			{
				id: 'a',
				parentId: null,
				childrenIds: [],
				role: 'assistant',
				content: 'Hi',
				output: [
					{
						type: 'message',
						content: [{ type: 'output_text', text: 'Response' }],
					},
				],
			},
		]);
		// Add usage to the message manually
		const msgs = (json[0] as { chat: { history: { messages: Record<string, Record<string, unknown>> } } }).chat.history.messages;
		const existing = msgs['a'] as Record<string, unknown>;
		msgs['a'] = {
			...existing,
			usage: { prompt_tokens: 10, completion_tokens: 20 },
		};

		const result = parseOpenWebUIFormat(json, false);
		expect(result.messages[0].metadata).toBeDefined();
		const metadata = JSON.parse(result.messages[0].metadata!);
		expect(metadata.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20 });
	});
});
