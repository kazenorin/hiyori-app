import { describe, it, expect } from 'vitest';
import { constraintsFromSnapshot, mapEffortValue } from '../effort';

describe('mapEffortValue', () => {
	it('maps null to none', () => expect(mapEffortValue(null)).toBe('none'));
	it('maps default to provider-default', () => expect(mapEffortValue('default')).toBe('provider-default'));
	it('maps max to max', () => expect(mapEffortValue('max')).toBe('max'));
	it('passes through low', () => expect(mapEffortValue('low')).toBe('low'));
});

describe('constraintsFromSnapshot', () => {
	const base = { name: 'X', reasoning: false, tool_call: false, attachment: false, context: 4096 };

	it('no reasoning → no effort/toggle/budget', () => {
		const c = constraintsFromSnapshot(base, 'openai-compatible');
		expect(c.effortValues).toBeUndefined();
		expect(c.hasToggle).toBe(false);
		expect(c.hasBudget).toBe(false);
	});

	it('effort option → constrained values', () => {
		const c = constraintsFromSnapshot(
			{ ...base, reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }] },
			'openai-compatible'
		);
		expect(c.effortValues).toEqual(['provider-default', 'low', 'medium', 'high']);
		expect(c.hasToggle).toBe(false);
	});

	it('toggle option → hasToggle true', () => {
		const c = constraintsFromSnapshot({ ...base, reasoning: true, reasoning_options: [{ type: 'toggle' }] }, 'openrouter');
		expect(c.hasToggle).toBe(true);
	});

	it('budget on openrouter → hasBudget true', () => {
		const c = constraintsFromSnapshot(
			{ ...base, reasoning: true, reasoning_options: [{ type: 'budget_tokens', min: 128, max: 32768 }] },
			'openrouter'
		);
		expect(c.hasBudget).toBe(true);
		expect(c.budgetMin).toBe(128);
		expect(c.budgetMax).toBe(32768);
	});

	it('budget on non-openrouter → hasBudget false', () => {
		const c = constraintsFromSnapshot(
			{ ...base, reasoning: true, reasoning_options: [{ type: 'budget_tokens', min: 128, max: 32768 }] },
			'openai-compatible'
		);
		expect(c.hasBudget).toBe(false);
	});

	it('temperature false → temperatureSupported false', () => {
		const c = constraintsFromSnapshot({ ...base, temperature: false }, 'openai-compatible');
		expect(c.temperatureSupported).toBe(false);
	});

	it('temperature absent → temperatureSupported true', () => {
		const c = constraintsFromSnapshot(base, 'openai-compatible');
		expect(c.temperatureSupported).toBe(true);
	});
});
