export type RiskOutcome = -1 | 0 | 1;

export function evaluateRisk(riskLevel: number, random: number): RiskOutcome {
	const normalized = (riskLevel - 1) / 9.0;
	const pBad = 0.1 + 0.6 * normalized;
	const pNeutral = 0.2;

	if (random < pBad) return -1;
	if (random < pBad + pNeutral) return 0;
	return 1;
}
