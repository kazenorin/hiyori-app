import { parseContent } from '$lib/chat-stream-parser/parser';
import type { OutputDescriptor } from '$lib/chat-stream-parser/types';
import { summaryHeader } from '$lib/definitions/common-headers';
import { totalViolationsLabel, recommendationLabel, acceptAsIsLabel } from '$lib/definitions/pipeline-prompts';

interface ReviewerOutputSummary {
	totalViolations: string | undefined;
	recommendation: string | undefined;
}

function stripCodeFences(text: string): string {
	return text.replace(/^```[^\n]*\n/, '').replace(/\n```[\s]*$/, '');
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
 * Parse reviewer output and determine whether the Editor phase can be skipped.
 *
 * Uses chat-stream-parser with locale-aware descriptors to match the Summary
 * section's labeled list items (total violations and recommendation) regardless
 * of the active locale.
 */
export function reviewerAcceptsAsIs(reviewerOutput: string | undefined): boolean {
	if (!reviewerOutput) return false;

	const { totalViolations, recommendation } = parseReviewerOutput(reviewerOutput);

	if (!totalViolations || !recommendation) return false;

	const violationsZero = totalViolations.trim() === '0';
	const recommendationAccept = recommendation.toLowerCase().trim() === acceptAsIsLabel().toLowerCase().trim();

	return violationsZero && recommendationAccept;
}
