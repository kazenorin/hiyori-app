import { tool } from 'ai';
import { z } from 'zod';
import type { ToolSet } from 'ai';
import type { ToolContext } from './tools';
import { evaluateRisk } from '$lib/ai/risk-model';
import type { RiskOutcome } from '$lib/ai/risk-model';
import { fileLog, log } from '$lib/logging/logger';

const TOOL_DESCRIPTION =
	'Evaluates the outcome of taking a risk by rolling a dice. ' +
	'The higher the risk level, the more likely a bad outcome. ' +
	'Use this to determine whether a risky action succeeds, has a mixed result, or fails.';

const RISK_LEVEL_DESCRIPTION = 'Level of risk taken (1 = lowest risk, 10 = highest risk)';

const OUTCOME_MESSAGES = {
	[-1]: 'The risk resulted in a bad outcome.',
	[0]: 'The risk resulted in a neutral outcome.',
	[1]: 'The risk resulted in a good outcome.',
} as const satisfies Record<RiskOutcome, string>;

export function createEvaluateRiskTool(_ctx: ToolContext) {
	return tool({
		description: TOOL_DESCRIPTION,
		inputSchema: z.object({
			riskLevel: z.number().int().min(1).max(10).describe(RISK_LEVEL_DESCRIPTION),
		}),
		execute: async (input): Promise<{ result: string }> => {
			const logMessage = `evaluate-risk triggered: riskLevel=${input.riskLevel}`;
			await log.debug('tool', logMessage);
			await fileLog('debug', 'tool', logMessage);

			const outcome = evaluateRisk(input.riskLevel, Math.random());
			const result = OUTCOME_MESSAGES[outcome];

			const endLogMessage = `evaluate-risk result: riskLevel=${input.riskLevel}, outcome=${outcome}`;
			await log.debug('tool', endLogMessage);
			await fileLog('debug', 'tool', endLogMessage);

			return { result };
		},
	});
}

export function buildRiskTools(ctx: ToolContext): ToolSet {
	return {
		'evaluate-risk': createEvaluateRiskTool(ctx),
	};
}
