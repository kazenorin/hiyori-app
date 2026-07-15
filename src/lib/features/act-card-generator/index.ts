import type { Message, MessageBase } from '$lib/db/messages';
import type { ActLineMeta } from '$lib/db/act-lines';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { actCardTemplateLoader } from '$lib/fs/prompts';
import { exportActLine } from '$lib/ai/act-line-export';
import { getMessagesForLine } from '$lib/db/act-lines';
import { ensureWorldFile } from '$lib/ai/world-generator';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { fs } from '$lib/fs/file-system';
import { getLineDir } from '$lib/ai/card-output-path';
import { logActCardActivity } from '$lib/logging/chat-logger';
import { type RetryConfig, streamWithRetry } from '$lib/ai/chat-stream';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { actCardExtractionPrompt, actCardSystemPrompt, actCardTranscriptEnd, actCardTranscriptStart, worldContextLabel } from './prompts';
import { ERR_NO_MAIN_PROVIDER, ERR_NO_NARRATIVE_CONTENT } from '$lib/definitions/error-messages';
import { actWithNumberLabel } from '$lib/definitions/common-labels';

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
	messageIdSuffix: string | null;
}

export interface StreamActCardParams {
	storyId: string;
	storyName: string;
	actLineId: string;
	actLine: ActLineMeta;
	actNumber: number;
	abortSignal?: AbortSignal;
	preloadedMessages?: Message[];
}

export interface StreamActCardResult {
	filePath: string;
	content: string;
}

function computeActCardFilename(messageIdSuffix: string): string {
	return `act-card-${messageIdSuffix}.md`;
}

async function resolveActCardContext(params: StreamActCardParams, abortSignal?: AbortSignal): Promise<ActCardContext> {
	const config = getMainProviderConfig();
	if (!config?.model) {
		throw new Error(ERR_NO_MAIN_PROVIDER);
	}

	const allMessages = params.preloadedMessages ?? (await getMessagesForLine(params.actLineId));
	const contents = exportActLine(allMessages);
	if (contents.length === 0) {
		throw new Error(ERR_NO_NARRATIVE_CONTENT);
	}

	const isMainLine = params.actLine.isMainLine ?? false;
	const messageIdSuffix = allMessages.at(-1)?.id.slice(-8) ?? null;

	const [template, world] = await Promise.all([
		actCardTemplateLoader.loadByStory(params.storyId, params.storyName),
		ensureWorldFile(params.storyId, params.storyName, abortSignal),
	]);
	const extractionPrompt = actCardExtractionPrompt();

	const namedTemplate = template
		.replaceAll('{{story title}}', params.storyName)
		.replaceAll('{{act number}}', actWithNumberLabel(params.actNumber));

	return {
		storyId: params.storyId,
		actLineId: params.actLineId,
		isMainLine,
		actNumber: params.actNumber,
		storyName: params.storyName,
		systemPrompt: actCardSystemPrompt(),
		userMessageContents: buildUserMessages(contents, namedTemplate, extractionPrompt, world),
		world,
		messageIdSuffix,
	};
}

async function resolveAndWrite(ctx: ActCardContext, content: string): Promise<string> {
	const storyFolder = await resolveStoryFolder(ctx.storyId, ctx.storyName);
	const lineDir = await getLineDir(storyFolder, ctx.actNumber, ctx.isMainLine, ctx.actLineId);
	if (!ctx.messageIdSuffix) throw new Error(ERR_NO_NARRATIVE_CONTENT);
	const filename = computeActCardFilename(ctx.messageIdSuffix);
	const filePath = `${lineDir}/${filename}`;

	await fs.writeTextFileEnsuringDir(filePath, content);

	return filePath;
}

export async function streamActCard(
	params: StreamActCardParams,
	onProgress: (state: StreamState) => void,
	retryConfig: RetryConfig = { retryCount: 3, backoffIntervalSeconds: 2 }
): Promise<StreamActCardResult> {
	const ctx = await resolveActCardContext(params, params.abortSignal);

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
		abortSignal: params.abortSignal,
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

async function resolveActCardPath(
	messages: Message[],
	storyFolder: string,
	actNumber: number,
	isMainLine: boolean,
	actLineId: string
): Promise<{ filePath: string; exists: boolean; messageIdSuffix: string | null }> {
	const lastMessage = messages.at(-1);
	const lineDir = await getLineDir(storyFolder, actNumber, isMainLine, actLineId);
	if (!lastMessage) {
		return { filePath: '', exists: false, messageIdSuffix: null };
	}
	const messageIdSuffix = lastMessage.id.slice(-8);
	const filename = computeActCardFilename(messageIdSuffix);
	const filePath = `${lineDir}/${filename}`;
	const exists = await fs.exists(filePath);
	return { filePath, exists, messageIdSuffix };
}

export interface EnsureActCardOptions {
	storyId: string;
	storyName: string;
	actLineId: string;
	actLine: ActLineMeta;
	actNumber: number;
	onProgress?: (state: StreamState) => void;
	abortSignal?: AbortSignal;
}

export interface EnsureActCardResult {
	filePath: string;
	content: string;
	generated: boolean;
}

export async function ensureActCard(opts: EnsureActCardOptions): Promise<EnsureActCardResult> {
	const messages = await getMessagesForLine(opts.actLineId);
	if (messages.length === 0) throw new Error(ERR_NO_NARRATIVE_CONTENT);

	const storyFolder = await resolveStoryFolder(opts.storyId, opts.storyName);
	const { filePath, exists, messageIdSuffix } = await resolveActCardPath(
		messages,
		storyFolder,
		opts.actNumber,
		opts.actLine.isMainLine ?? false,
		opts.actLineId
	);
	if (messageIdSuffix === null) throw new Error(ERR_NO_NARRATIVE_CONTENT);
	if (exists) {
		return { filePath, content: await fs.readTextFile(filePath), generated: false };
	}
	const result = await streamActCard(
		{
			storyId: opts.storyId,
			storyName: opts.storyName,
			actLineId: opts.actLineId,
			actLine: opts.actLine,
			actNumber: opts.actNumber,
			abortSignal: opts.abortSignal,
			preloadedMessages: messages,
		},
		opts.onProgress ?? (() => {})
	);
	return { filePath: result.filePath, content: result.content, generated: true };
}
