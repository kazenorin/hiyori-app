import { parseContent } from '$lib/utils/chat-stream-parser/parser';
import type { OutputDescriptor } from '$lib/utils/chat-stream-parser/types';
import { summaryHeader } from '$lib/definitions/common-headers';
import { totalViolationsLabel, recommendationLabel, acceptAsIsLabel } from '$lib/definitions/pipeline-prompts';
import { stripCodeFences } from '$lib/utils/strings';

interface ReviewerOutputSummary {
	totalViolations: string | undefined;
	recommendation: string | undefined;
}

function getReviewerDescriptors(): OutputDescriptor[] {
	return [
		{
			outputPath: 'totalViolations',
			match: {
				type: 'list_labeled_item',
				content: totalViolationsLabel(),
				parent: { type: 'header', content: summaryHeader() },
			},
			bodyOnly: true,
		},
		{
			outputPath: 'recommendation',
			match: {
				type: 'list_labeled_item',
				content: recommendationLabel(),
				parent: { type: 'header', content: summaryHeader() },
			},
			bodyOnly: true,
		},
	];
}

function parseReviewerOutput(reviewerOutput: string): ReviewerOutputSummary {
	return parseContent(stripCodeFences(reviewerOutput), getReviewerDescriptors());
}

/**
 * Normalize a recommendation value for tolerant, locale-safe comparison: trim, lowercase, and
 * collapse hyphen/whitespace runs so "accept as-is", "Accept As-Is" and "accept as is" all reduce
 * to the same form as the localized {@link acceptAsIsLabel}.
 */
function normalizeForMatch(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[-\s]+/g, ' ');
}

/**
 * True when the violation count is zero. Matches a leading `0` token so model variants like "0",
 * "0 violations" and "0 (none found)" count as zero, while "1"/"10" do not. Locale-independent:
 * the review template emits the digit `0` in every locale.
 */
function isZeroViolations(totalViolations: string): boolean {
	return /^\s*0\b/.test(totalViolations);
}

/**
 * True when the recommendation is an "accept as-is" verdict. Prefix-matches the localized label
 * (after {@link normalizeForMatch}) so trailing wording the model may add — e.g.
 * "accept as-is (no changes needed)" — still counts, while "minor edits needed" or a negated
 * "do not accept as-is" does not.
 */
function isAcceptAsIs(recommendation: string): boolean {
	const label = normalizeForMatch(acceptAsIsLabel());
	return label.length > 0 && normalizeForMatch(recommendation).startsWith(label);
}

/**
 * Parse reviewer output and determine whether the Editor phase can be skipped.
 *
 * Uses chat-stream-parser with locale-aware descriptors to match the Summary section's labeled
 * list items (total violations and recommendation) regardless of the active locale. The verdict is
 * tolerant of cosmetic model deviations (extra wording, casing, hyphenation) because the v2
 * shared-prefix path places the output-format template in a user message rather than the system
 * prompt, so the reviewer drifts from the exact template more often. Both a zero violation count
 * AND an accept-as-is recommendation are required, so any non-accept verdict still routes to the Editor.
 */
export function reviewerAcceptsAsIs(reviewerOutput: string | undefined): boolean {
	if (!reviewerOutput) return false;

	const { totalViolations, recommendation } = parseReviewerOutput(reviewerOutput);

	if (!totalViolations || !recommendation) return false;

	return isZeroViolations(totalViolations) && isAcceptAsIs(recommendation);
}
