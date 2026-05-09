import type { MessageBase } from '$lib/db/messages';
import { generateText, type ModelMessage } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import { loadActCardTemplate, loadActExtractionPrompt, loadStorySystemPrompt } from '$lib/fs/prompts';
import { exportActLine } from './act-line-export';
import { getMessagesForLine, getActLine } from '$lib/db/act-lines';
import { getAct } from '$lib/db/acts';
import { loadStoryWorldContent, resolveStoryFolder } from '$lib/fs/story-folders';
import { getActiveStoryId, getActiveActId, getActiveActLineId, getActiveStory } from '$lib/stores/stories.svelte';
import { mkdir, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { buildLineDir, resolveLineDir } from './card-output-path';
import { logActCardActivity } from '$lib/logging/chat-logger';
import { streamWithRetry, type RetryConfig } from './chat-stream';
import type { StreamState } from './chat-callbacks';

export interface GenerateActCardResult {
	filePath: string;
	content: string;
}

function buildUserMessages(contents: string[], template: string, extractionPrompt: string, world: string | null): string[] {
	const worldPrompt = world ? ['The world setting is based on the following:', world] : [];
	return [
		...worldPrompt,
		'The following messages will contain the transcript of the current act:',
		...contents,
		'The previous message was the end of the transcript of the current act. The following message will contain the Act Card template:',
		template,
		extractionPrompt,
	];
}

interface ActCardContext {
	storyId: string;
	actLineId: string;
	isMainLine: boolean;
	actNumber: number;
	storyName: string;
	systemPrompt: string;
	userMessageContents: string[];
	world: string | null;
}

async function resolveActCardContext(): Promise<ActCardContext> {
	const storyId = getActiveStoryId();
	const actId = getActiveActId();
	const actLineId = getActiveActLineId();
	const story = getActiveStory();

	if (!storyId || !actId || !actLineId || !story) {
		throw new Error('No active act line selected.');
	}

	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		throw new Error('No main provider configured. Please set one in Settings.');
	}

	const allMessages = await getMessagesForLine(actLineId);
	const contents = exportActLine(allMessages);
	if (contents.length === 0) {
		throw new Error('No narrative content found in this act line.');
	}

	const act = await getAct(actId);
	if (!act) {
		throw new Error('Active act not found.');
	}

	const actLine = await getActLine(actLineId);
	const isMainLine = actLine?.isMainLine ?? false;

	const [template, extractionPrompt, systemPrompt, world] = await Promise.all([
		loadActCardTemplate(),
		loadActExtractionPrompt(),
		loadStorySystemPrompt(story.id, story.name),
		loadStoryWorldContent(story.id),
	]);

	return {
		storyId,
		actLineId,
		isMainLine,
		actNumber: act.actNumber,
		storyName: story.name,
		systemPrompt,
		userMessageContents: buildUserMessages(contents, template, extractionPrompt, world),
		world,
	};
}

async function resolveAndWrite(ctx: ActCardContext, content: string): Promise<string> {
	const storyFolder = await resolveStoryFolder(ctx.storyId, ctx.storyName);
	const lineDir = ctx.isMainLine
		? buildLineDir(storyFolder, ctx.actNumber, true, ctx.actLineId)
		: await resolveLineDir(storyFolder, ctx.actNumber, ctx.actLineId);
	const filePath = `${lineDir}/act-card.md`;

	await mkdir(lineDir, { baseDir: BaseDirectory.AppData, recursive: true });
	await writeTextFile(filePath, content, { baseDir: BaseDirectory.AppData });

	return filePath;
}

export async function generateActCard(): Promise<GenerateActCardResult> {
	const ctx = await resolveActCardContext();

	const model = createModel(getMainProviderConfig()!);
	const userMessages: ModelMessage[] = ctx.userMessageContents.map((content) => ({
		role: 'user',
		content,
	}));

	await logActCardActivity('generation-start', `Act line: ${ctx.actLineId}\n\nMessages:\n${JSON.stringify(userMessages, null, 2)}`);

	const result = await generateText({
		model,
		system: ctx.systemPrompt,
		messages: userMessages,
	});

	await logActCardActivity(
		'generation-end',
		`
  Result: ${result.text}
  Usage: ${JSON.stringify(result.usage, null, 4)}
  Finish Reason: ${result.finishReason}`
	);

	const filePath = await resolveAndWrite(ctx, result.text);
	return { filePath, content: result.text };
}

export interface StreamActCardResult {
	filePath: string;
	content: string;
}

export async function streamActCard(
	onProgress: (state: StreamState) => void,
	retryConfig: RetryConfig = { retryCount: 3, backoffIntervalSeconds: 2 }
): Promise<StreamActCardResult> {
	const ctx = await resolveActCardContext();

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
