import { ls } from '$lib/localization';

const MIN_ESTIMATE = 1;
const MAX_ESTIMATE = 100;

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clamp(n: number): number | null {
	return Number.isFinite(n) && n >= MIN_ESTIMATE && n <= MAX_ESTIMATE ? n : null;
}

function buildLabelRe(label: string): RegExp {
	const escaped = escapeRegex(label);
	const ws = '[^\\S\\n]'; // whitespace except newline — keeps label match on one line
	return new RegExp(`#{0,6}${ws}*[-*]?${ws}*\\*{0,2}${ws}*${escaped}${ws}*\\*{0,2}${ws}*:?`, 'i');
}

function findInline(text: string, labelRe: RegExp): number | null {
	const re = new RegExp(labelRe.source + '[^\\d\\n]*(\\d+)', labelRe.flags);
	const m = re.exec(text);
	return m ? clamp(parseInt(m[1], 10)) : null;
}

function findInBody(text: string, labelRe: RegExp): number | null {
	const match = labelRe.exec(text);
	if (!match) return null;

	const fromLabel = text.slice(match.index + match[0].length);
	const headingIdx = fromLabel.search(/\n#{1,6}\s/);
	const section = headingIdx === -1 ? fromLabel : fromLabel.slice(0, headingIdx);

	const numMatch = section.match(/\d+/);
	return numMatch ? clamp(parseInt(numMatch[0], 10)) : null;
}

export function parseActPhaseLengthEstimate(scenePlot: string | null | undefined): number | null {
	if (!scenePlot) return null;

	const label = ls('pipeline.labels.plotPlanner.estimatedLength');
	if (!label) return null;

	const labelRe = buildLabelRe(label);
	return findInline(scenePlot, labelRe) ?? findInBody(scenePlot, labelRe);
}
