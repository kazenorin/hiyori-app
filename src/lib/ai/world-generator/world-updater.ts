import type { MessageBase } from '$lib/db/messages';
import { streamText } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { loadUpdateWorldFromActPrompt, loadUpdateWorldFromActSystemPrompt, loadWorldTemplate } from '$lib/fs/prompts';
import { BaseDirectory, exists, rename, writeTextFile } from '@tauri-apps/plugin-fs';
import { ls } from '$lib/localization';
import { worldContentHeader, actSummaryHeader, interviewTranscriptHeader } from '$lib/definitions/common-headers';
import { ERR_API_KEY_AND_MODEL_NOT_CONFIGURED } from '$lib/definitions/error-messages';
import { log } from '$lib/logging/logger';

const LOG_TAG = 'world-updater';

export interface UpdateWorldCardParams {
	folderName: string;
	currentWorldContent: string;
	actSummary: string;
	interviewTranscript: MessageBase[];
	abortSignal?: AbortSignal;
}

export async function updateWorldCard(params: UpdateWorldCardParams): Promise<string> {
	const worldPath = `${params.folderName}/world.md`;
	const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
	const backupPath = `${params.folderName}/world-${timestamp}.md`;

	if (await exists(worldPath, { baseDir: BaseDirectory.AppData })) {
		await log.info(LOG_TAG, `Backing up world.md to world-${timestamp}.md`);
		await rename(worldPath, backupPath, {
			newPathBaseDir: BaseDirectory.AppData,
			oldPathBaseDir: BaseDirectory.AppData,
		});
	}

	const [systemPrompt, extractionPrompt, worldTemplate] = await Promise.all([
		loadUpdateWorldFromActSystemPrompt(),
		loadUpdateWorldFromActPrompt(),
		loadWorldTemplate(),
	]);

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
	if (!config?.apiKey || !config?.model) {
		throw new Error(ERR_API_KEY_AND_MODEL_NOT_CONFIGURED);
	}

	try {
		await log.info(LOG_TAG, 'Starting world card update');

		const model = createModel(config);
		const result = streamText({ model, messages, system: systemPrompt, abortSignal: params.abortSignal });

		const contentParts: string[] = [];
		for await (const part of result.fullStream) {
			if (part.type === 'text-delta') contentParts.push(part.text);
		}

		const updatedContent = contentParts.join('');
		await writeTextFile(worldPath, updatedContent, { baseDir: BaseDirectory.AppData });

		await log.info(LOG_TAG, `World card update complete. Length: ${updatedContent.length} chars`);
		return updatedContent;
	} catch (err) {
		await log.error(LOG_TAG, 'World card update failed, restoring backup', err);
		if (await exists(backupPath, { baseDir: BaseDirectory.AppData })) {
			await rename(backupPath, worldPath, {
				newPathBaseDir: BaseDirectory.AppData,
				oldPathBaseDir: BaseDirectory.AppData,
			});
		}
		throw err;
	}
}
