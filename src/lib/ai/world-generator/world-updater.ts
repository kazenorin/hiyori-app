import type { MessageBase } from '$lib/db/messages';
import { streamText } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { worldTemplateLoader } from '$lib/fs/prompts';
import { fs } from '$lib/fs/file-system';
import { worldFromActSystemPrompt, worldFromActPrompt } from '$lib/definitions/feature-prompts';
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

	if (await fs.exists(worldPath)) {
		await log.info(LOG_TAG, `Backing up world.md to world-${timestamp}.md`);
		await fs.rename(worldPath, backupPath);
	}

	const [systemPrompt, extractionPrompt, worldTemplate] = await Promise.all([
		Promise.resolve(worldFromActSystemPrompt()),
		Promise.resolve(worldFromActPrompt()),
		worldTemplateLoader.loadDefault(),
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

		const model = await createModel(config);
		const result = streamText({ model, messages, system: systemPrompt, abortSignal: params.abortSignal });

		const contentParts: string[] = [];
		for await (const part of result.fullStream) {
			if (part.type === 'text-delta') contentParts.push(part.text);
		}

		const updatedContent = contentParts.join('');
		await fs.writeTextFile(worldPath, updatedContent);

		await log.info(LOG_TAG, `World card update complete. Length: ${updatedContent.length} chars`);
		return updatedContent;
	} catch (err) {
		await log.error(LOG_TAG, 'World card update failed, restoring backup', err);
		if (await fs.exists(backupPath)) {
			await fs.rename(backupPath, worldPath);
		}
		throw err;
	}
}
