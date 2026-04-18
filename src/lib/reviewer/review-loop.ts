import { streamWithRetry, type RetryConfig } from '$lib/ai/chat-stream';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { getReviewerProviderConfig, getMainProviderConfig } from '$lib/stores/settings.svelte';
import {
	loadReviewerSystemPrompt,
	loadRevisionModeFragment,
	loadRevisionRequestExtractionPrompt,
	loadSystemPrompt
} from '$lib/fs/prompts';
import { knownCharacterNameList } from '$lib/memory/memory';
import { log } from '$lib/logging/logger';

export interface ReviewViolation {
	rule: string;
	severity: 'critical' | 'warning';
	description: string;
	offending_excerpt: string;
	suggested_fix: string | null;
}

export interface ReviewResult {
	approved: boolean;
	violations: ReviewViolation[];
}

export interface ReviewLoopResult {
	review: ReviewResult;
	revisedContent: string;
}

const RETRY_CONFIG: RetryConfig = { retryCount: 2, backoffIntervalSeconds: 2 };

function parseReviewJson(content: string): ReviewResult | null {
	// Strip possible markdown fences
	let json = content.trim();
	const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenceMatch) {
		json = fenceMatch[1].trim();
	}

	try {
		const parsed = JSON.parse(json);
		if (typeof parsed.approved === 'boolean' && Array.isArray(parsed.violations)) {
			return parsed as ReviewResult;
		}
	} catch {
		// Try to find JSON object in the content
		const braceStart = json.indexOf('{');
		const braceEnd = json.lastIndexOf('}');
		if (braceStart !== -1 && braceEnd > braceStart) {
			try {
				const extracted = JSON.parse(json.slice(braceStart, braceEnd + 1));
				if (typeof extracted.approved === 'boolean' && Array.isArray(extracted.violations)) {
					return extracted as ReviewResult;
				}
			} catch {
				// Give up
			}
		}
	}
	return null;
}

function buildReviewHistory(
	transcript: { role: 'user' | 'assistant'; content: string }[]
): { role: 'user' | 'assistant'; content: string }[] {
	return [
		{ role: 'user', content: 'Below is the transcript:' },
		...transcript.slice(0, -1).map(msg => ({
			role: 'user' as const,
			content: msg.role === 'user'
				? `Player responded: ${msg.content}`
				: msg.content,
		})),
		{
			role: 'user',
			content: `End of transcript.\nBelow is the GM's Output to review:\n\n${transcript[transcript.length - 1].content}`,
		},
	];
}

function getProviderConfig() {
	return getReviewerProviderConfig() ?? getMainProviderConfig();
}

export async function streamReview(
	transcript: { role: 'user' | 'assistant'; content: string }[],
	onReviewProgress?: (state: StreamState) => void,
	onRevisionProgress?: (state: StreamState) => void,
): Promise<ReviewLoopResult | null> {
	// Step 1: Run the Reviewer
	const [systemPromptTemplate, characterNames] = await Promise.all([
		loadReviewerSystemPrompt(),
		knownCharacterNameList(),
	]);

	const systemPrompt = systemPromptTemplate.replace(
		'{knownCharacterNameList}',
		JSON.stringify(characterNames)
	);

	const reviewHistory = buildReviewHistory(transcript);
	const providerConfig = getProviderConfig();

	log.debug('review-loop', 'Starting review pass');

	const reviewAccumulator = await streamWithRetry(
		systemPrompt,
		reviewHistory,
		RETRY_CONFIG,
		onReviewProgress ?? (() => {}),
		(err, attempt) => log.warn('review-loop', `Review attempt ${attempt} failed: ${err.message}`),
		providerConfig,
	);

	// Step 2: Parse the Review JSON
	const review = parseReviewJson(reviewAccumulator.state.content);

	if (!review || review.approved) {
		log.debug('review-loop', review ? 'Draft approved' : 'Review parse failed, passing through');
		return null;
	}

	log.info('review-loop', `Draft rejected: ${review.violations.length} violations found`);

	// Step 3: Revision
	const [mainSystemPrompt, revisionFragment, revisionTemplate] = await Promise.all([
		loadSystemPrompt(),
		loadRevisionModeFragment(),
		loadRevisionRequestExtractionPrompt(),
	]);

	const revisionSystemPrompt = mainSystemPrompt + '\n\n' + revisionFragment;
	const reviewJson = JSON.stringify({
		approved: review.approved,
		violations: review.violations,
	});

	const revisionHistory = [
		...transcript,
		{
			role: 'user' as const,
			content: revisionTemplate.replace('{reviewer_json_report}', reviewJson),
		},
	];

	log.debug('review-loop', 'Starting revision pass');

	const revisionAccumulator = await streamWithRetry(
		revisionSystemPrompt,
		revisionHistory,
		RETRY_CONFIG,
		onRevisionProgress ?? (() => {}),
		(err, attempt) => log.warn('review-loop', `Revision attempt ${attempt} failed: ${err.message}`),
		providerConfig,
	);

	return {
		review,
		revisedContent: revisionAccumulator.state.content,
	};
}
