import { generateText } from 'ai';
import { createModel } from '$lib/ai/provider';
import { getMinorTaskAgentProviderConfig } from '$lib/stores/settings.svelte';
import { ls } from '$lib/localization';
import { log } from '$lib/logging/logger';
import { WORLD_TEMPLATES } from '$lib/features/world-builder/template-registry';
import { fs } from '$lib/fs/file-system';

export const WORLD_TEMPLATE_ID_FILE = 'world-template-id';

const CLASSIFICATION_CHAR_LIMIT = 3000;

export async function readWorldTemplateId(folderName: string): Promise<string | null> {
	try {
		const content = await fs.readTextFileIfExists(`${folderName}/${WORLD_TEMPLATE_ID_FILE}`);
		if (!content) return null;
		const id = content.trim().toLowerCase();
		return WORLD_TEMPLATES.some((t) => t.id === id) ? id : null;
	} catch (err) {
		await log.warn(
			'template-resolution',
			`Failed to read ${WORLD_TEMPLATE_ID_FILE}: ${err instanceof Error ? err.message : String(err)}.`
		);
		return null;
	}
}

export async function writeWorldTemplateId(folderName: string, templateId: string | null): Promise<void> {
	if (!templateId) return;
	const path = `${folderName}/${WORLD_TEMPLATE_ID_FILE}`;
	await fs.writeTextFile(path, templateId);
}

export async function resolveTemplateForUpdate(folderName: string, currentWorldContent: string): Promise<string> {
	const templateId = await readWorldTemplateId(folderName);
	if (templateId) {
		const entry = WORLD_TEMPLATES.find((t) => t.id === templateId);
		if (entry) return entry.loader.loadDefault();
	}

	const classifiedId = await classifyWorldTemplate(currentWorldContent);
	if (classifiedId) {
		await writeWorldTemplateId(folderName, classifiedId);
		const entry = WORLD_TEMPLATES.find((t) => t.id === classifiedId);
		if (entry) return entry.loader.loadDefault();
	}

	const fallback = WORLD_TEMPLATES.find((t) => t.id === 'high-fantasy');
	return fallback ? fallback.loader.loadDefault() : '';
}

async function classifyWorldTemplate(content: string): Promise<string | null> {
	const config = getMinorTaskAgentProviderConfig();
	if (!config) return null;

	const model = await createModel(config);
	const systemPrompt = ls('features.worldBuilder.templateClassifierSystemPrompt');
	const truncated = content.slice(0, CLASSIFICATION_CHAR_LIMIT);

	try {
		const result = await generateText({ model, system: systemPrompt, prompt: truncated, ...(config.callSettings ?? {}) });
		const response = result.text.trim().toLowerCase();
		for (const entry of WORLD_TEMPLATES) {
			if (response.includes(entry.id)) {
				return entry.id;
			}
		}
		return null;
	} catch (err) {
		await log.warn('template-resolution', `Template classification failed: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

export async function resolveTemplateForGeneration(folderName: string | null, classificationContent: string | null): Promise<string> {
	if (folderName) {
		const templateId = await readWorldTemplateId(folderName);
		if (templateId) {
			const entry = WORLD_TEMPLATES.find((t) => t.id === templateId);
			if (entry) return entry.loader.loadDefault();
		}
	}

	if (classificationContent) {
		const classifiedId = await classifyWorldTemplate(classificationContent);
		if (classifiedId) {
			const entry = WORLD_TEMPLATES.find((t) => t.id === classifiedId);
			if (entry) {
				if (folderName) {
					await writeWorldTemplateId(folderName, classifiedId);
				}
				return entry.loader.loadDefault();
			}
		}
	}

	const fallback = WORLD_TEMPLATES.find((t) => t.id === 'high-fantasy');
	return fallback ? fallback.loader.loadDefault() : '';
}
