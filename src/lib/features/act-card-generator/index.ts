import type { MessageBase } from '$lib/db/messages';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { actCardTemplateLoader } from '$lib/fs/prompts';
import { exportActLine } from '$lib/ai/act-line-export';
import { getActLine, getMessagesForLine } from '$lib/db/act-lines';
import { getAct } from '$lib/db/acts';
import { ensureWorldFile } from '$lib/ai/world-generator';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { getActiveActLineId } from '$lib/stores/stories.svelte';
import { fs } from '$lib/fs/file-system';
import { getLineDir } from '$lib/ai/card-output-path';
import { logActCardActivity } from '$lib/logging/chat-logger';
import { type RetryConfig, streamWithRetry } from '$lib/ai/chat-stream';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { actCardExtractionPrompt, actCardSystemPrompt, actCardTranscriptEnd, actCardTranscriptStart, worldContextLabel } from './prompts';
import {
	ERR_ACT_NOT_FOUND,
	ERR_NO_ACT_LINE_SELECTED,
	ERR_NO_MAIN_PROVIDER,
	ERR_NO_NARRATIVE_CONTENT,
	ERR_STORY_NOT_FOUND,
} from '$lib/definitions/error-messages';
import { getStory } from '$lib/db/stories';

function buildUserMessages(contents: string[], template: string, extractionPrompt: string, world: string): string[] {
	const worldPrompt = [worldContextLabel(), world];
	return [...worldPrompt, actCardTranscriptStart(), ...contents, actCardTranscriptEnd(), template, extractionPrompt];
}

interface ActCardContext {
	storyId: string;
	actLineId: string;
	isMainLine: boolean;
	actNumber: number;
	storyName: string;
	systemPrompt: string;
	userMessageContents: string[];
	world: string;
}

async function resolveActCardContext(abortSignal?: AbortSignal): Promise<ActCardContext> {
	const config = getMainProviderConfig();
	if (!config?.model) {
		throw new Error(ERR_NO_MAIN_PROVIDER);
	}

	const actLineId = getActiveActLineId();
	const actLine = actLineId ? await getActLine(actLineId) : null;
	if (!actLineId || !actLine) {
		throw new Error(ERR_NO_ACT_LINE_SELECTED);
	}

	const allMessages = await getMessagesForLine(actLineId);
	const contents = exportActLine(allMessages);
	if (contents.length === 0) {
		throw new Error(ERR_NO_NARRATIVE_CONTENT);
	}

	const act = await getAct(actLine.actId);
	if (!act) {
		throw new Error(ERR_ACT_NOT_FOUND);
	}
	const story = await getStory(act.storyId);
	if (!story) {
		throw new Error(ERR_STORY_NOT_FOUND);
	}

	const isMainLine = actLine.isMainLine ?? false;

	const [template, world] = await Promise.all([
		actCardTemplateLoader.loadByStory(story.id, story.name),
		ensureWorldFile(story.id, story.name, abortSignal),
	]);
	const extractionPrompt = actCardExtractionPrompt();

	return {
		storyId: story.id,
		actLineId,
		isMainLine,
		actNumber: act.actNumber,
		storyName: story.name,
		systemPrompt: actCardSystemPrompt(),
		userMessageContents: buildUserMessages(contents, template, extractionPrompt, world),
		world,
	};
}

async function resolveAndWrite(ctx: ActCardContext, content: string): Promise<string> {
	const storyFolder = await resolveStoryFolder(ctx.storyId, ctx.storyName);
	const lineDir = await getLineDir(storyFolder, ctx.actNumber, ctx.isMainLine, ctx.actLineId);
	const filePath = `${lineDir}/act-card.md`;

	await fs.writeTextFileEnsuringDir(filePath, content);

	return filePath;
}

export interface StreamActCardResult {
	filePath: string;
	content: string;
}

export async function streamActCard(
	onProgress: (state: StreamState) => void,
	retryConfig: RetryConfig = { retryCount: 3, backoffIntervalSeconds: 2 },
	abortSignal?: AbortSignal
): Promise<StreamActCardResult> {
	const ctx = await resolveActCardContext(abortSignal);

	const config = getMainProviderConfig()!;
	const userMessages: MessageBase[] = ctx.userMessageContents.map((content) => ({
		role: 'user',
		content,
	}));

	await logActCardActivity('generation-start', `Act line: ${ctx.actLineId}`);

	const accumulator = await streamWithRetry(ctx.systemPrompt, userMessages, {
		retryConfig,
		onProgress,
		onError: (err, attempt) => {
			onProgress({
				content: '',
				reasoning: `Attempt ${attempt} failed: ${err.message}. Retrying...`,
				variables: null,
			});
		},
		providerConfig: config,
		abortSignal,
	});

	const content = accumulator.state.content;

	await logActCardActivity(
		'generation-end',
		`
  Result: ${content}
  Usage: ${JSON.stringify(accumulator.resultMetadata, null, 4)}`
	);

	const filePath = await resolveAndWrite(ctx, content);
	return { filePath, content };
}
