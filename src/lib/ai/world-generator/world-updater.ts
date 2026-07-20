import type { MessageBase } from '$lib/db/messages';
import { streamText } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { fs } from '$lib/fs/file-system';
import { worldFromActPrompt, worldFromActSystemPrompt } from '$lib/definitions/feature-prompts';
import { ls } from '$lib/localization';
import { actSummaryHeader, interviewTranscriptHeader, worldContentHeader } from '$lib/definitions/common-headers';
import { ERR_API_KEY_AND_MODEL_NOT_CONFIGURED } from '$lib/definitions/error-messages';
import { log } from '$lib/logging/logger';
import { resolveTemplateForUpdate } from './template-resolution';
import { WORLD_MD } from '$lib/ai/world-generator/constants';

const LOG_TAG = 'world-updater';

export interface UpdateWorldCardParams {
	folderName: string;
	currentWorldContent: string;
	actSummary: string;
	interviewTranscript: MessageBase[];
	abortSignal?: AbortSignal;
}

async function backupWorldFile(worldPath: string, backupPath: string) {
	if (await fs.exists(worldPath)) {
		await log.info(LOG_TAG, `Backing up ${WORLD_MD} to ${backupPath}`);
		try {
			await fs.rename(worldPath, backupPath);
		} catch (err) {
			await log.error(LOG_TAG, 'World card backup failed', err);
			throw err;
		}
	}
}

async function restoreWorldFile(worldPath: string, backupPath: string) {
	if (await fs.exists(backupPath)) {
		try {
			await fs.rename(backupPath, worldPath);
		} catch (err) {
			await log.error(LOG_TAG, `Failed to restore ${WORLD_MD} from ${backupPath}`, err);
		}
	}
}

export async function updateWorldCard(params: UpdateWorldCardParams): Promise<string> {
	const worldPath = `${params.folderName}/${WORLD_MD}`;
	const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
	const backupPath = `${params.folderName}/world-${timestamp}.md`;

	const systemPrompt = worldFromActSystemPrompt();
	const extractionPrompt = worldFromActPrompt();
	const worldTemplate = await resolveTemplateForUpdate(params.folderName, params.currentWorldContent);

	const userInstruction = extractionPrompt + '\n\n---\n\n' + worldTemplate;

	const messages: MessageBase[] = [
		{ role: 'user', content: `## ${worldContentHeader()}\n\n${params.currentWorldContent}` },
		{ role: 'user', content: `## ${actSummaryHeader()}\n\n${params.actSummary}` },
	];

	const validTranscript = params.interviewTranscript.filter((m) => m.content);
	if (validTranscript.length > 0) {
		messages.push({
			role: 'user',
			content: `## ${interviewTranscriptHeader()}\n\n${ls('common.descriptions.interviewTranscript')}`,
		});
		messages.push(...validTranscript);
	}

	messages.push({ role: 'user', content: userInstruction });

	const config = getMainProviderConfig();
	if (!config?.model) {
		throw new Error(ERR_API_KEY_AND_MODEL_NOT_CONFIGURED);
	}

	await log.info(LOG_TAG, 'Starting world card update');

	const model = await createModel(config);
	const result = streamText({
		model,
		messages,
		system: systemPrompt,
		abortSignal: params.abortSignal,
		...(config.callSettings ?? {}),
	});

	const contentParts: string[] = [];
	for await (const part of result.fullStream) {
		if (part.type === 'text-delta') contentParts.push(part.text);
	}

	const updatedContent = contentParts.join('');
	await backupWorldFile(worldPath, backupPath);

	try {
		await fs.writeTextFile(worldPath, updatedContent);
	} catch (err) {
		await log.error(LOG_TAG, 'World card update failed, restoring backup', err);
		await restoreWorldFile(worldPath, backupPath);
		throw err;
	}

	await log.info(LOG_TAG, `World card update complete. Length: ${updatedContent.length} chars`);
	return updatedContent;
}
