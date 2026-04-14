import { generateText } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import { loadActCardTemplate, loadActExtractionPrompt } from '$lib/fs/act-card-prompts';
import { loadSystemPrompt } from '$lib/fs/system-prompt';
import { exportActLine } from './act-line-export';
import { getMessagesForLine, getActLine } from '$lib/db/act-lines';
import { getAct } from '$lib/db/acts';
import { resolveStoryFolder } from '$lib/fs/story-prompts';
import { getActiveStoryId, getActiveActId, getActiveActLineId, getActiveStory } from '$lib/stores/stories.svelte';
import { mkdir, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { buildLineDir } from './card-output-path';

export interface GenerateActCardResult {
	filePath: string;
	content: string;
}

function buildUserMessage(contents: string[], template: string): string {
	const transcript = contents.join('\n\n---\n\n');

	return `Here is the narrative content for this act line:

${transcript}

---

Using the provided source, fill this template:

${template}`;
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
	const template = await loadActCardTemplate();
	const extractionPrompt = await loadActExtractionPrompt();
	const systemPrompt = await loadSystemPrompt();

	// Build system prompt: main chat system prompt + extraction instructions
	const combinedSystemPrompt = `${systemPrompt}\n\n---\n\n${extractionPrompt}`;

	// Build AI call
	const model = createModel(config);
	const userContent = buildUserMessage(contents, template);

	const result = await generateText({
		model,
		system: combinedSystemPrompt,
		messages: [
			{ role: 'user', content: userContent }
		]
	});

	// Resolve file path
	const storyFolder = await resolveStoryFolder(storyId, story.name);
	const lineDir = buildLineDir(storyFolder, act.actNumber, isMainLine, actLineId);
	const filePath = `${lineDir}/act-card.md`;

	// Write file (overwrites if exists)
	await mkdir(lineDir, { baseDir: BaseDirectory.AppData, recursive: true });
	await writeTextFile(filePath, result.text, { baseDir: BaseDirectory.AppData });

	return { filePath, content: result.text };
}
