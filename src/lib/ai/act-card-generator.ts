import { generateText } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import { loadActCardTemplate, loadActExtractionPrompt } from '$lib/fs/act-card-prompts';
import { getMessagesForLine, getActLine } from '$lib/db/act-lines';
import { getAct } from '$lib/db/acts';
import { resolveStoryFolder } from '$lib/fs/story-prompts';
import { getActiveStoryId, getActiveActId, getActiveActLineId, getActiveStory } from '$lib/stores/stories.svelte';
import { mkdir, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';

export interface GenerateActCardResult {
	filePath: string;
	content: string;
}

function computeFilename(isMainLine: boolean, actLineId: string): string {
	if (isMainLine) return 'main-line.md';
	return `line-${actLineId.slice(-8)}.md`;
}

function buildUserMessage(messages: Array<{ role: string; content: string }>, template: string): string {
	const transcript = messages
		.map((m) => `[${m.role.toUpperCase()}]:\n${m.content}`)
		.join('\n\n---\n\n');

	return `Here is the chat history for this act line:

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

	// Gather messages
	const messages = await getMessagesForLine(actLineId);
	if (messages.length === 0) {
		throw new Error('No messages found in this act line.');
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

	// Build AI call
	const model = createModel(config);
	const userContent = buildUserMessage(messages, template);

	const result = await generateText({
		model,
		system: extractionPrompt,
		messages: [
			{ role: 'user', content: userContent }
		]
	});

	// Resolve file path
	const storyFolder = await resolveStoryFolder(storyId, story.name);
	const actDir = `${storyFolder}/act-${act.actNumber}`;
	const filename = computeFilename(isMainLine, actLineId);
	const filePath = `${actDir}/${filename}`;

	// Write file
	await mkdir(actDir, { baseDir: BaseDirectory.AppData, recursive: true });
	await writeTextFile(filePath, result.text, { baseDir: BaseDirectory.AppData });

	return { filePath, content: result.text };
}
