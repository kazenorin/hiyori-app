import {generateText, type ModelMessage} from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import { loadActCardTemplate, loadActExtractionPrompt, loadSystemPrompt } from '$lib/fs/prompts';
import { exportActLine } from './act-line-export';
import { getMessagesForLine, getActLine } from '$lib/db/act-lines';
import { getAct } from '$lib/db/acts';
import { loadStoryWorldContent, resolveStoryFolder } from '$lib/fs/story-folders';
import { getActiveStoryId, getActiveActId, getActiveActLineId, getActiveStory } from '$lib/stores/stories.svelte';
import { mkdir, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { buildLineDir } from './card-output-path';
import { logActCardActivity } from '$lib/logging/chat-logger';
import { streamWithRetry, type RetryConfig } from './chat-stream';
import type { StreamState } from './chat-callbacks';

export interface GenerateActCardResult {
	filePath: string;
	content: string;
}

function buildUserMessages(contents: string[], template: string, extractionPrompt: string, world: string | null): string[] {
	const worldPrompt = !!world ? [
		'The world setting is based on the following:',
		world
	] : [];
	return [
		...worldPrompt,
		'The following messages will contain the transcript of the current act:',
		...contents,
		'The previous message was the end of the transcript of the current act. The following message will contain the Act Card template:',
		template,
		extractionPrompt
	];
}

export async function generateActCard(): Promise<GenerateActCardResult> {
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

	// Gather and filter messages
	const allMessages = await getMessagesForLine(actLineId);
	const contents = exportActLine(allMessages);
	if (contents.length === 0) {
		throw new Error('No narrative content found in this act line.');
	}

	// Get act info for act number
	const act = await getAct(actId);
	if (!act) {
		throw new Error('Active act not found.');
	}

	// Check if main line
	const actLine = await getActLine(actLineId);
	const isMainLine = actLine?.isMainLine ?? false;

	// Load prompts
	const [template, extractionPrompt, systemPrompt, world] = await Promise.all([
		loadActCardTemplate(),
		loadActExtractionPrompt(),
		loadSystemPrompt(),
		loadStoryWorldContent(act.storyId)
	]);

	// Build AI call
	const model = createModel(config);
	const userMessages: ModelMessage[] = buildUserMessages(contents, template, extractionPrompt, world).map((content) => ({
		role: 'user', content
	}));

	await logActCardActivity('generation-start', `Act line: ${actLineId}\n\nMessages:\n${JSON.stringify(userMessages, null, 2)}`);

	const result = await generateText({
		model,
		system: systemPrompt,
		messages: userMessages
	});

	await logActCardActivity('generation-end', `
  Result: ${result.text}
  Usage: ${JSON.stringify(result.usage, null, 4)}
  Finish Reason: ${result.finishReason}`);

	// Resolve file path
	const storyFolder = await resolveStoryFolder(storyId, story.name);
	const lineDir = buildLineDir(storyFolder, act.actNumber, isMainLine, actLineId);
	const filePath = `${lineDir}/act-card.md`;

	// Write file (overwrites if exists)
	await mkdir(lineDir, { baseDir: BaseDirectory.AppData, recursive: true });
	await writeTextFile(filePath, result.text, { baseDir: BaseDirectory.AppData });

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

	// Gather and filter messages
	const allMessages = await getMessagesForLine(actLineId);
	const contents = exportActLine(allMessages);
	if (contents.length === 0) {
		throw new Error('No narrative content found in this act line.');
	}

	// Get act info for act number
	const act = await getAct(actId);
	if (!act) {
		throw new Error('Active act not found.');
	}

	// Check if main line
	const actLine = await getActLine(actLineId);
	const isMainLine = actLine?.isMainLine ?? false;

	// Load prompts
	const [template, extractionPrompt, systemPrompt, world] = await Promise.all([
		loadActCardTemplate(),
		loadActExtractionPrompt(),
		loadSystemPrompt(),
		loadStoryWorldContent(story.id)
	]);

	// Build messages for streaming
	const userMessages: { role: 'user' | 'assistant'; content: string }[] = buildUserMessages(contents, template, extractionPrompt, world).map((content) => ({
		role: 'user',
		content
	}));

	await logActCardActivity('generation-start', `Act line: ${actLineId}`);

	// Stream with retry
	const accumulator = await streamWithRetry(
		systemPrompt,
		userMessages,
		retryConfig,
		onProgress,
		(err, attempt) => {
			onProgress({
				content: '',
				reasoning: `Attempt ${attempt} failed: ${err.message}. Retrying...`,
				gameData: null,
				reviewScratchpad: null,
				revisedNarrative: null,
				revisedGameData: null
			});
		},
		config
	);

	const content = accumulator.state.content;

	await logActCardActivity('generation-end', `
	  Result: ${content}
	  Usage: ${JSON.stringify(accumulator.resultMetadata, null, 4)}`);

	// Resolve file path
	const storyFolder = await resolveStoryFolder(storyId, story.name);
	const lineDir = buildLineDir(storyFolder, act.actNumber, isMainLine, actLineId);
	const filePath = `${lineDir}/act-card.md`;

	// Write file (overwrites if exists)
	await mkdir(lineDir, { baseDir: BaseDirectory.AppData, recursive: true });
	await writeTextFile(filePath, content, { baseDir: BaseDirectory.AppData });

	return { filePath, content };
}
