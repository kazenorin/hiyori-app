import { describe, it, expect } from 'vitest';
import { evaluateRisk } from '$lib/ai/risk-model';

describe('evaluateRisk', () => {
	it('at riskLevel 1, p_bad = 0.10, p_neutral = 0.20', () => {
		expect(evaluateRisk(1, 0.0)).toBe(-1);
		expect(evaluateRisk(1, 0.09)).toBe(-1);
		expect(evaluateRisk(1, 0.1)).toBe(0);
		expect(evaluateRisk(1, 0.29)).toBe(0);
		expect(evaluateRisk(1, 0.31)).toBe(1);
		expect(evaluateRisk(1, 1.0)).toBe(1);
	});

	it('at riskLevel 10, p_bad = 0.70, p_neutral = 0.20', () => {
		expect(evaluateRisk(10, 0.0)).toBe(-1);
		expect(evaluateRisk(10, 0.69)).toBe(-1);
		expect(evaluateRisk(10, 0.7)).toBe(0);
		expect(evaluateRisk(10, 0.89)).toBe(0);
		expect(evaluateRisk(10, 0.9)).toBe(1);
	});

	it('at riskLevel 5, p_bad ≈ 0.367, p_neutral = 0.20', () => {
		expect(evaluateRisk(5, 0.35)).toBe(-1);
		expect(evaluateRisk(5, 0.37)).toBe(0);
		expect(evaluateRisk(5, 0.55)).toBe(0);
		expect(evaluateRisk(5, 0.57)).toBe(1);
	});

	it('at random = 0, always bad since p_bad > 0', () => {
		for (let rl = 1; rl <= 10; rl++) {
			expect(evaluateRisk(rl, 0)).toBe(-1);
		}
	});

	it('at random >= 1, always good since p_bad + p_neutral < 1', () => {
		for (let rl = 1; rl <= 10; rl++) {
			expect(evaluateRisk(rl, 1)).toBe(1);
		}
	});
});
