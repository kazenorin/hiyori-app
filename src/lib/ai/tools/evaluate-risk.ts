import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolSet } from 'ai';
import type { ToolContext } from './tools';
import { evaluateRisk } from '$lib/utils/risk-model';
import type { RiskOutcome } from '$lib/utils/risk-model';
import { log } from './utils';

const OUTCOME_LABELS: Record<RiskOutcome, string> = {
	[-1]: 'tools.evaluateRisk.messages.outcomeBad',
	[0]: 'tools.evaluateRisk.messages.outcomeNeutral',
	[1]: 'tools.evaluateRisk.messages.outcomeGood',
};

function getOutcomeMessage(outcome: RiskOutcome): string {
	return ls(OUTCOME_LABELS[outcome]);
}

export function createEvaluateRiskTool(_ctx: ToolContext) {
	return tool({
		description: ls('tools.evaluateRisk.description'),
		inputSchema: z.object({
			riskLevel: z.number().int().min(1).max(10).describe(ls('tools.evaluateRisk.parameters.riskLevel')),
		}),
		execute: async (input): Promise<{ result: string }> => {
			await log(`evaluate-risk triggered: riskLevel=${input.riskLevel}`);

			const outcome = evaluateRisk(input.riskLevel, Math.random());
			const result = getOutcomeMessage(outcome);

			await log(`evaluate-risk result: riskLevel=${input.riskLevel}, outcome=${outcome}`);

			return { result };
		},
	});
}

export function buildRiskTools(ctx: ToolContext): ToolSet {
	return {
		'evaluate-risk': createEvaluateRiskTool(ctx),
	};
}
