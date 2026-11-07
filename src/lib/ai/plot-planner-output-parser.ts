import { ls } from '#lib/localization/index.ts';

export const MIN_ESTIMATE = 1;
export const MAX_ESTIMATE = 100;
export const DEFAULT_ESTIMATE = 2;

export interface ScenePlotEstimateParts {
	prose: string;
	estimate: number | null;
	labelPrefix: string | null;
}

interface EstimateMatch {
	value: number | null;
	start: number;
	prefixEnd: number;
	end: number;
}

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

function estimateLabelRe(): RegExp | null {
	const label = ls('pipeline.labels.plotPlanner.estimatedLength');
	return label ? buildLabelRe(label) : null;
}

function lineStart(text: string, index: number): number {
	return index > 0 ? text.lastIndexOf('\n', index - 1) + 1 : 0;
}

function lineEnd(text: string, index: number): number {
	const nextNewline = text.indexOf('\n', index);
	return nextNewline === -1 ? text.length : nextNewline;
}

function matchEstimate(text: string, labelRe: RegExp): EstimateMatch | null {
	const inlineRe = new RegExp(labelRe.source + '[^\\d\\n]*(\\d+)', labelRe.flags);
	const inline = inlineRe.exec(text);
	if (inline) {
		return {
			value: clamp(parseInt(inline[1], 10)),
			start: lineStart(text, inline.index),
			prefixEnd: inline.index + inline[0].length - inline[1].length,
			end: lineEnd(text, inline.index),
		};
	}

	const label = labelRe.exec(text);
	if (!label) return null;

	const labelEnd = label.index + label[0].length;
	const fromLabel = text.slice(labelEnd);
	const headingIdx = fromLabel.search(/\n#{1,6}\s/);
	const section = headingIdx === -1 ? fromLabel : fromLabel.slice(0, headingIdx);
	const numMatch = section.match(/\d+/);

	return {
		value: numMatch ? clamp(parseInt(numMatch[0], 10)) : null,
		start: lineStart(text, label.index),
		prefixEnd: lineEnd(text, label.index),
		end: headingIdx === -1 ? text.length : labelEnd + headingIdx,
	};
}

export function parseActPhaseLengthEstimate(scenePlot: string | null | undefined): number | null {
	if (!scenePlot) return null;

	const labelRe = estimateLabelRe();
	if (!labelRe) return null;

	return matchEstimate(scenePlot, labelRe)?.value ?? null;
}

export function splitScenePlotEstimate(scenePlot: string): ScenePlotEstimateParts {
	const labelRe = estimateLabelRe();
	const match = labelRe ? matchEstimate(scenePlot, labelRe) : null;
	if (!match) {
		return { prose: scenePlot.trim(), estimate: null, labelPrefix: null };
	}

	const prose = [scenePlot.slice(0, match.start), scenePlot.slice(match.end)]
		.map((part) => part.trim())
		.filter(Boolean)
		.join('\n\n');

	return {
		prose,
		estimate: match.value,
		// Verbatim: the heading is a story-locale string, so re-emitting it from ls() could rewrite it.
		labelPrefix: scenePlot.slice(match.start, match.prefixEnd).trimEnd() || null,
	};
}

export function joinScenePlotEstimate(prose: string, estimate: number, labelPrefix: string | null): string {
	const heading = labelPrefix ?? `## ${ls('pipeline.labels.plotPlanner.estimatedLength')}`;
	const section = `${heading}\n\n${estimate}`;
	const body = prose.trim();
	return body ? `${body}\n\n${section}` : section;
}
