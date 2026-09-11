import { ls } from '$lib/localization';
import { requirementsHeader, sectionFormat } from '$lib/definitions/common-headers';

/** Modal-verb categories the world-builder agent can assign to an explicit requirement. */
export const REQUIREMENT_CATEGORIES = ['must', 'should', 'may', 'mustNot', 'will'] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export interface Requirement {
	category: RequirementCategory;
	requirement: string;
}

/** Localized modal-verb label for a category (e.g. `must` → "Must"). */
export function requirementCategoryLabel(category: RequirementCategory): string {
	return ls(`common.labels.requirementCategories.${category}`);
}

/** Render requirements as `- **<Label>:** <text>` bullets, in recording order. */
export function renderRequirementLines(reqs: Requirement[]): string[] {
	return reqs.map((r) => `- **${requirementCategoryLabel(r.category)}:** ${r.requirement}`);
}

/** Header-less joined lines. Empty string when there are no requirements. */
export function renderRequirementsText(reqs: Requirement[]): string {
	return renderRequirementLines(reqs).join('\n');
}

/** Full block (`## Requirements` header + lines) for a permanent sidecar. Empty string when no requirements. */
export function formatRequirementsBlock(reqs: Requirement[]): string {
	if (reqs.length === 0) return '';
	return sectionFormat(requirementsHeader()) + renderRequirementsText(reqs);
}

/** Rebuild the headed block from header-less lines (used when folding the act-plot sidecar into act-plot.md). */
export function formatRequirementsBlockFromLines(lines: string): string {
	const trimmed = lines.trim();
	if (!trimmed) return '';
	return sectionFormat(requirementsHeader()) + trimmed;
}

/** Prompt-injection form: header + honor-description + lines. Empty string when no requirements. */
export function formatRequirementsContext(reqs: Requirement[]): string {
	if (reqs.length === 0) return '';
	return sectionFormat(requirementsHeader()) + ls('common.descriptions.requirements') + '\n\n' + renderRequirementsText(reqs);
}

/** True when an identical category+text requirement is already present (in-memory dedup). */
export function isDuplicateRequirement(reqs: Requirement[], candidate: Requirement): boolean {
	return reqs.some((r) => r.category === candidate.category && r.requirement === candidate.requirement);
}

/**
 * Append one rendered line to a header-less sidecar body, deduping against existing lines.
 * Returns the input unchanged when the exact line is already present.
 */
export function appendRequirementLine(existingLines: string, req: Requirement): string {
	const line = renderRequirementLines([req])[0];
	const body = existingLines.replace(/\s+$/, '');
	if (!body) return line;
	if (body.split('\n').includes(line)) return existingLines;
	return `${body}\n${line}`;
}
