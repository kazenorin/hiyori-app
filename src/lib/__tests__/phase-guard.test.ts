import { describe, it, expect, vi } from 'vitest';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { withPhaseGuards, SIDE_EFFECTING_TOOLS } from '#lib/ai/tools/phase-guard.ts';
import { guardToolsForBackgroundPhase, guardToolsForPhase } from '#lib/ai/tools/tools.ts';

// Executing a guarded no-op calls ls() with an unloaded locale cache, which would log a
// missing-key warning; silence it like other tests that exercise ls()-backed code paths.
vi.mock('#lib/logging/logger.ts', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
	setLogLevel: vi.fn(),
}));

function fakeTools(): ToolSet {
	return {
		'read-scene': tool({
			description: 'read',
			inputSchema: z.object({}),
			execute: async () => 'scene-content',
		}),
		'update-inventory': tool({
			description: 'write',
			inputSchema: z.object({}),
			execute: async () => 'written',
		}),
	};
}

describe('withPhaseGuards strict mode', () => {
	it('standard mode passes read-only tools through by reference', () => {
		const tools = fakeTools();
		const guarded = withPhaseGuards(tools, [], () => 'no-op');
		expect(guarded['read-scene']).toBe(tools['read-scene']);
		expect(guarded['update-inventory']).not.toBe(tools['update-inventory']);
	});

	it('strict mode no-ops read-only tools outside the allow-list', async () => {
		const tools = fakeTools();
		const guarded = withPhaseGuards(tools, [], () => 'no-op', true);
		expect(await guarded['read-scene'].execute!({}, {} as never)).toBe('no-op');
		expect(await guarded['update-inventory'].execute!({}, {} as never)).toBe('no-op');
	});

	it('strict mode preserves description and inputSchema (byte-identical schema)', () => {
		const tools = fakeTools();
		const guarded = withPhaseGuards(tools, [], () => 'no-op', true);
		for (const name of Object.keys(tools)) {
			expect(guarded[name].description).toBe(tools[name].description);
			expect(guarded[name].inputSchema).toBe(tools[name].inputSchema);
		}
	});

	it('allowed tools pass through even in strict mode', async () => {
		const tools = fakeTools();
		const guarded = withPhaseGuards(tools, ['read-scene'], () => 'no-op', true);
		expect(await guarded['read-scene'].execute!({}, {} as never)).toBe('scene-content');
	});

	it('update-inventory is registered as side-effecting', () => {
		expect(SIDE_EFFECTING_TOOLS.has('update-inventory')).toBe(true);
	});
});

describe('guardToolsForBackgroundPhase', () => {
	it('returns undefined for undefined input', () => {
		expect(guardToolsForBackgroundPhase(undefined, 'SUMMARIZER')).toBeUndefined();
	});

	it('no-ops read-only tools for SUMMARIZER while the standard guard does not', async () => {
		const tools = fakeTools();
		const backgroundGuarded = guardToolsForBackgroundPhase(tools, 'SUMMARIZER')!;
		const standardGuarded = guardToolsForPhase(tools, 'GAME_MASTER')!;
		expect(await backgroundGuarded['read-scene'].execute!({}, {} as never)).not.toBe('scene-content');
		expect(await standardGuarded['read-scene'].execute!({}, {} as never)).toBe('scene-content');
	});
});
