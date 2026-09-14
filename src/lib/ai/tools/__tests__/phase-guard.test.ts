import { describe, it, expect, vi } from 'vitest';
import { withPhaseGuards } from '../phase-guard';
import type { ToolSet } from 'ai';

const fakeTool = (execute: () => unknown) => ({ description: 'd', inputSchema: {}, execute }) as never;
const call = (t: unknown) => (t as { execute: () => Promise<unknown> }).execute();

describe('withPhaseGuards', () => {
	it('passes read-only tools through untouched (same object reference)', () => {
		const tools = { 'read-scene': fakeTool(() => 'ok') } as ToolSet;
		const out = withPhaseGuards(tools, [], () => 'blocked');
		expect(out['read-scene']).toBe(tools['read-scene']);
	});

	it('no-ops a side-effecting tool disallowed in the phase and preserves its schema', async () => {
		// Why: the model now sees every tool, so a disallowed side effect must be
		// neutralized at runtime — but description/inputSchema stay identical so the
		// serialized tool block remains byte-identical (cacheable) across phases.
		const exec = vi.fn(async () => ({ result: 'advanced' }));
		const tools = { 'advance-phase': fakeTool(exec) } as ToolSet;
		const out = withPhaseGuards(tools, [], (name) => ({ result: `${name} not allowed` }));
		expect(out['advance-phase'].description).toBe('d');
		await expect(call(out['advance-phase'])).resolves.toEqual({ result: 'advance-phase not allowed' });
		expect(exec).not.toHaveBeenCalled(); // original side effect never runs
	});

	it('delegates to the original execute when the phase allows the tool', async () => {
		const exec = vi.fn(async () => ({ result: 'advanced' }));
		const tools = { 'advance-phase': fakeTool(exec) } as ToolSet;
		const out = withPhaseGuards(tools, ['advance-phase'], () => ({ result: 'blocked' }));
		await call(out['advance-phase']);
		expect(exec).toHaveBeenCalled();
	});
});
