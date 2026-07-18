import type { Message, MessageBase } from '$lib/db/messages';
import type { ActLineMeta } from '$lib/db/act-lines';
import { getEndingType } from '$lib/db/act-lines';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { actCardTemplateLoader } from '$lib/fs/prompts';
import { exportActLine } from '$lib/ai/act-line-export';
import { getMessagesForLine } from '$lib/db/act-lines';
import { ensureWorldFile } from '$lib/ai/world-generator';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { fs } from '$lib/fs/file-system';
import { getLineDir } from '$lib/ai/card-output-path';
import { logActCardActivity } from '$lib/logging/chat-logger';
import { streamWithRetry } from '$lib/ai/chat-stream';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { getEndingLabel } from '$lib/ai/pipeline/runners';
import { ls } from '$lib/localization';
import { actCardExtractionPrompt, actCardSystemPrompt, actCardTranscriptEnd, actCardTranscriptStart, worldContextLabel } from './prompts';
import { ERR_NO_MAIN_PROVIDER, ERR_NO_NARRATIVE_CONTENT } from '$lib/definitions/error-messages';
import { actWithNumberLabel } from '$lib/definitions/common-labels';

export interface ActCardParams {
	storyId: string;
	storyName: string;
	actLineId: string;
	actLine: ActLineMeta;
	actNumber: number;
	abortSignal?: AbortSignal;
	onProgress?: (state: StreamState) => void;
}

export interface EnsureActCardResult {
	filePath: string;
	content: string;
	generated: boolean;
}

interface ResolvedActCard {
	filePath: string;
	exists: boolean;
	messages: Message[];
	messageIdSuffix: string;
}

export async function checkActCardExists(params: ActCardParams): Promise<boolean> {
	const { exists } = await resolveActCard(params);
	return exists;
}

export async function ensureActCard(params: ActCardParams): Promise<EnsureActCardResult> {
	const resolved = await resolveActCard(params);
	if (resolved.exists) {
		return { filePath: resolved.filePath, content: await fs.readTextFile(resolved.filePath), generated: false };
	}
	return generateActCard(params, resolved);
}

export async function generateNewActCard(params: ActCardParams): Promise<EnsureActCardResult> {
	const resolved = await resolveActCard(params);

	let backupPath: string | null = null;
	if (resolved.exists) {
		const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
		const dir = resolved.filePath.substring(0, resolved.filePath.lastIndexOf('/'));
		backupPath = `${dir}/act-card-${resolved.messageIdSuffix}-${timestamp}.md`;
		await logActCardActivity('generation-start', `Backing up existing act card to ${backupPath}`);
		await fs.rename(resolved.filePath, backupPath);
	}

	try {
		return generateActCard(params, resolved);
	} catch (err) {
		if (backupPath && (await fs.exists(backupPath))) {
			await logActCardActivity('generation-end', 'Generation failed, restoring backup');
			await fs.rename(backupPath, resolved.filePath);
		}
		throw err;
	}
}

async function resolveActCard(params: ActCardParams): Promise<ResolvedActCard> {
	const messages = await getMessagesForLine(params.actLineId);
	if (messages.length === 0) throw new Error(ERR_NO_NARRATIVE_CONTENT);

	const lastMessage = messages.at(-1)!;
	const messageIdSuffix = lastMessage.id.slice(-8);

	const storyFolder = await resolveStoryFolder(params.storyId, params.storyName);
	const isMainLine = params.actLine.isMainLine ?? false;
	const lineDir = await getLineDir(storyFolder, params.actNumber, isMainLine, params.actLineId);
	const filePath = `${lineDir}/${computeActCardFilename(messageIdSuffix)}`;
	const exists = await fs.exists(filePath);

	return { filePath, exists, messages, messageIdSuffix };
}

function computeActCardFilename(messageIdSuffix: string): string {
	return `act-card-${messageIdSuffix}.md`;
}

async function generateActCard(params: ActCardParams, resolved: ResolvedActCard): Promise<EnsureActCardResult> {
	const config = getMainProviderConfig();
	if (!config?.model) throw new Error(ERR_NO_MAIN_PROVIDER);

	const contents = exportActLine(resolved.messages);
	if (contents.length === 0) throw new Error(ERR_NO_NARRATIVE_CONTENT);

	const [template, world] = await Promise.all([
		actCardTemplateLoader.loadByStory(params.storyId, params.storyName),
		ensureWorldFile(params.storyId, params.storyName, params.abortSignal),
	]);

	const endingType = await getEndingType(params.actLineId);
	const endingLabel = endingType ? getEndingLabel(endingType) : ls('common.descriptions.endings.notEnded');

	const namedTemplate = template
		.replaceAll('{{story title}}', params.storyName)
		.replaceAll('{{act number}}', actWithNumberLabel(params.actNumber))
		.replaceAll('{{ending type}}', endingLabel);

	const userMessages: MessageBase[] = buildUserMessages(contents, namedTemplate, actCardExtractionPrompt(), world);

	await logActCardActivity('generation-start', `Act line: ${params.actLineId}`);

	const onProgress = params.onProgress ?? (() => {});
	const accumulator = await streamWithRetry(actCardSystemPrompt(), userMessages, {
		retryConfig: { retryCount: 3, backoffIntervalSeconds: 2 },
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

	await fs.writeTextFileEnsuringDir(resolved.filePath, content);

	return { filePath: resolved.filePath, content, generated: true };
}

function buildUserMessages(contents: string[], template: string, extractionPrompt: string, world: string): MessageBase[] {
	const worldPrompt = [worldContextLabel(), world];
	return [...worldPrompt, actCardTranscriptStart(), ...contents, actCardTranscriptEnd(), template, extractionPrompt].map((content) => ({
		role: 'user',
		content,
	}));
}
