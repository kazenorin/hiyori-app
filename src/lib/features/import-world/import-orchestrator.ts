// Main import orchestrator coordinating all import steps

import { createStory, deleteStory } from '$lib/db/stories';
import { createAct, deleteAct } from '$lib/db/acts';
import { addMessageToLine, createActLine, deleteActLine, deleteLineEntries } from '$lib/db/act-lines';
import { getDefaultPlotMode, settings } from '$lib/stores/settings.svelte';
import { createMessage, deleteMessage } from '$lib/db/messages';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { deleteStoryFolder } from '$lib/db/story-folders';
import { getFileSystem } from '$lib/fs/file-system';
import { loadStories } from '$lib/stores/stories.svelte';
import { kebabCase } from 'lodash-es';
import type {
	CreatedResources,
	ImportFormData,
	ImportPreviewAct,
	ImportPreviewData,
	ImportPreviewMessage,
	ImportProgressUpdate,
	ImportResult,
	ParsedMessage,
} from './types';
import { emptyVariables } from '$lib/ai/narrative-types';
import type { RetryConfig } from '$lib/ai/chat-stream';
import { parseTranscriptFile } from './transcript-parsers';
import { runNarrativeFilling } from './narrative-filler';
import { generateWorldFromCards } from '$lib/ai/world-generator';
import { loadLocaleStrings } from '$lib/localization';
import {
	importWorldUnnamedCharacter,
	importWorldCompleteWithInterview,
	importWorldComplete,
	importWorldCompletedSuccessfully,
	importWorldFailed,
	importWorldProcessingAct,
	importWorldFillingNarrativeVariables,
	importWorldFillingNarrativeVariable,
	characterCardCoreIdentityLabel,
} from '$lib/definitions/feature-prompts';
import { nameLabel } from '$lib/definitions/common-labels';
import { type OutputDescriptor, parseContent } from '$lib/utils/chat-stream-parser';
import { setActiveLocale } from '$lib/fs/prompt-loader';

const fileFs = getFileSystem();

// === Progress Callback Type ===

export type ProgressCallback = (update: ImportProgressUpdate) => void;

// === Phase 1: Prepare Import ===

export async function prepareImport(formData: ImportFormData, onProgress: ProgressCallback): Promise<ImportPreviewData | null> {
	const locale = settings.locale;
	setActiveLocale(locale);
	await loadLocaleStrings(locale);

	const logs: string[] = [];

	function log(message: string): void {
		logs.push(message);
		onProgress({
			phase: 'creating-story',
			message,
			consoleOutput: logs.join('\n'),
		});
	}

	const createdResources: CreatedResources = {
		storyId: null,
		storyFolder: null,
		actIds: [],
		actLineIds: [],
		messageIds: [],
	};

	let worldContent: string | null = null;
	let storyFolder = '';
	let storyId = '';
	let storyName = '';

	try {
		log('Creating story...');
		storyId = crypto.randomUUID();
		storyName = formData.storyName.trim() || `Story-${storyId.slice(-8)}`;

		await createStory(storyId, storyName, locale);
		createdResources.storyId = storyId;
		log(`Story created: "${storyName}" (${storyId.slice(-8)})`);

		await loadStories();

		storyFolder = await resolveStoryFolder(storyId, storyName);
		createdResources.storyFolder = storyFolder;

		if (formData.worldFile) {
			worldContent = await formData.worldFile.text();
			const worldPath = `${storyFolder}/world.md`;
			await fileFs.writeTextFileEnsuringDir(worldPath, worldContent);
			log(`World file saved: ${formData.worldFile.name}`);
		}

		const characterCards = await loadCharacterCards(formData.characters, log);
		await saveCharacterCards(storyFolder, characterCards, log);

		const actCards = await readAndSaveActCards(storyFolder, formData, log);

		const interviewActCard = actCards.length > 0 ? actCards[actCards.length - 1] : null;
		if (!worldContent) {
			worldContent = await regenerateWorldFromCards(storyFolder, interviewActCard, characterCards, log);
		}
		const previewActs = await prepareActs(formData, storyId, createdResources, onProgress, log);

		return {
			storyId,
			storyFolder,
			storyName,
			worldContent,
			acts: previewActs,
			characterCards,
			actCards,
			interviewActCard,
			createdResources,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logs.push(`\n✗ Import preparation failed: ${errorMsg}`);
		logs.push('Cleaning up partially created data...');
		await cleanupImport(createdResources, logs);

		onProgress({
			phase: 'error',
			message: importWorldFailed(),
			errorMessage: errorMsg,
			consoleOutput: logs.join('\n'),
		});

		return null;
	}
}

// === Phase 2: Confirm Import ===

export async function confirmImport(preview: ImportPreviewData, onProgress: ProgressCallback): Promise<ImportResult> {
	const logs: string[] = [];

	function log(message: string): void {
		logs.push(message);
		onProgress({
			phase: 'saving-messages',
			message,
			consoleOutput: logs.join('\n'),
		});
	}

	try {
		for (const act of preview.acts) {
			const selectedMessages: ParsedMessage[] = act.messages
				.filter((m) => !m.removed && m.role !== 'system')
				.map(({ id: _id, removed: _removed, ...rest }) => rest);

			const messageIds = await createMessagesFromParsed(selectedMessages, act.actLineId, log, (msg) => {
				onProgress({
					phase: 'saving-messages',
					message: msg,
					consoleOutput: '',
				});
			});
			preview.createdResources.messageIds.push(...messageIds);
		}

		await loadStories();

		const needsInterview =
			preview.acts.length > 0 &&
			preview.acts[preview.acts.length - 1].messages.filter((m) => !m.removed && m.role !== 'system').length === 0;

		onProgress({
			phase: 'complete',
			message: needsInterview ? importWorldCompleteWithInterview() : importWorldComplete(),
			consoleOutput: logs.join('\n') + '\n\n✓ ' + importWorldCompletedSuccessfully(),
		});

		const firstActId = preview.acts.length > 0 ? preview.acts[0].actId : undefined;
		const lastActId = preview.acts.length > 0 ? preview.acts[preview.acts.length - 1].actId : undefined;
		const lastActLineId = preview.acts.length > 0 ? preview.acts[preview.acts.length - 1].actLineId : undefined;

		return {
			success: true,
			storyId: preview.storyId,
			actId: firstActId,
			lastActId,
			actLineId: lastActLineId,
			warnings: [],
			importComplete: true,
			needsInterview,
			worldContent: preview.worldContent ?? undefined,
			interviewContext: needsInterview
				? {
						actCard: preview.interviewActCard,
						characterCards: preview.characterCards,
					}
				: undefined,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logs.push(`\n✗ Import failed: ${errorMsg}`);
		logs.push('Cleaning up...');
		await cleanupImport(preview.createdResources, logs);

		onProgress({
			phase: 'error',
			message: importWorldFailed(),
			errorMessage: errorMsg,
			consoleOutput: logs.join('\n'),
		});

		return {
			success: false,
			error: errorMsg,
			warnings: [],
			importComplete: false,
		};
	}
}

// === Cancel Import ===

export async function cancelImport(preview: ImportPreviewData): Promise<void> {
	await cleanupImport(preview.createdResources, []);
}

// === Act Preparation ===

async function prepareActs(
	formData: ImportFormData,
	storyId: string,
	createdResources: CreatedResources,
	onProgress: ProgressCallback,
	log: (msg: string) => void
): Promise<ImportPreviewAct[]> {
	let previousActLineId: string | null = null;
	const previewActs: ImportPreviewAct[] = [];

	const retryConfig: RetryConfig = {
		retryCount: formData.retryCount,
		backoffIntervalSeconds: formData.backoffIntervalSeconds,
	};

	for (let actIndex = 0; actIndex < formData.acts.length; actIndex++) {
		const actInput = formData.acts[actIndex];
		const actNumber = actIndex + 1;

		const { actId, actLineId } = await createActAndLine(actInput, actNumber, storyId, previousActLineId, log, onProgress, createdResources);

		let messages: ImportPreviewMessage[] = [];
		if (actInput.transcript) {
			const parsed = await enrichTranscriptAct(actInput, formData.skipOptionalMalformed, retryConfig, log, onProgress);
			messages = toPreviewMessages(parsed);
		}

		previewActs.push({
			actId,
			actLineId,
			actName: actInput.name.trim() || `Act-${actId.slice(-8)}`,
			actNumber,
			messages,
		});

		previousActLineId = actLineId;
	}

	return previewActs;
}

async function createActAndLine(
	actInput: { id: string; name: string; actFile: File | null; transcript: File | null },
	actNumber: number,
	storyId: string,
	previousActLineId: string | null,
	log: (msg: string) => void,
	onProgress: ProgressCallback,
	createdResources: CreatedResources
): Promise<{ actId: string; actLineId: string }> {
	const isPlaceholderName = !actInput.name.trim();

	onProgress({
		phase: 'processing-act',
		message: importWorldProcessingAct(actNumber),
		consoleOutput: '',
	});

	const actId = crypto.randomUUID();
	const placeholderName = isPlaceholderName ? `Act-${actId.slice(-8)}` : actInput.name.trim();
	await createAct(actId, storyId, placeholderName, actNumber, previousActLineId);
	createdResources.actIds.push(actId);
	log(`Act ${actNumber} created: "${placeholderName}"`);

	const actLineId = crypto.randomUUID();
	await createActLine(actLineId, actId, 'Main Line', true, getDefaultPlotMode());
	createdResources.actLineIds.push(actLineId);

	return { actId, actLineId };
}

async function enrichTranscriptAct(
	actInput: { id: string; name: string; actFile: File | null; transcript: File | null },
	skipOptionalMalformed: boolean,
	retryConfig: RetryConfig,
	log: (msg: string) => void,
	onProgress: ProgressCallback
): Promise<ParsedMessage[]> {
	const transcriptName = actInput.transcript!.name;
	log(`Parsing transcript: ${transcriptName}`);

	const parsedTranscript = await parseTranscriptFile(actInput.transcript!, skipOptionalMalformed);
	const parsedMessages = [...parsedTranscript.messages];

	log(`Parsed ${parsedMessages.length} messages (${parsedTranscript.format} format)`);

	const missingNarrative = parsedMessages.filter((m) => m.role === 'assistant' && !m.variables?.sceneTitle).length;

	if (missingNarrative > 0) {
		onProgress({
			phase: 'processing-act',
			message: importWorldFillingNarrativeVariables(missingNarrative),
			consoleOutput: '',
		});
		log(`Filling narrative variables for ${missingNarrative} messages...`);

		const narrativeResults = await runNarrativeFilling(
			parsedMessages,
			retryConfig,
			log,
			(msgIndex, state) => {
				onProgress({
					phase: 'processing-act',
					message: importWorldFillingNarrativeVariable(msgIndex),
					consoleOutput: state.content ?? state.reasoning ?? '',
				});
			},
			(msgIndex, err, attempt) => {
				const errorContent = `[filling-narrative-variables] attempt ${attempt + 1} failed: ${err.message}. Retrying...`;
				onProgress({
					phase: 'processing-act',
					message: importWorldFillingNarrativeVariable(msgIndex),
					consoleOutput: '[ERROR]' + errorContent,
				});
			}
		);

		for (const result of narrativeResults) {
			if (result.variables) {
				const existing = parsedMessages[result.messageIndex].variables ?? emptyVariables();
				parsedMessages[result.messageIndex] = {
					...parsedMessages[result.messageIndex],
					variables: { ...existing, ...result.variables },
				};
			}
		}

		const filled = narrativeResults.filter((r) => r.variables).length;
		log(`Narrative filling: ${filled}/${missingNarrative} messages processed`);
	}

	return parsedMessages;
}

function toPreviewMessages(messages: ParsedMessage[]): ImportPreviewMessage[] {
	return messages.map((m) => ({
		id: crypto.randomUUID(),
		role: m.role,
		content: m.content,
		reasoning: m.reasoning,
		metadata: m.metadata,
		variables: m.variables,
		removed: false,
	}));
}

// === Helper Functions ===

async function regenerateWorldFromCards(
	storyFolder: string,
	interviewActCard: { actNumber: number; content: string } | null,
	characterCards: { name: string; content: string }[],
	log: (message: string) => void
) {
	let result: string | null = null;
	const lastActCardContent = interviewActCard?.content ?? null;
	if (lastActCardContent || characterCards.length > 0) {
		log('Generating world file from provided cards...');
		result = await generateWorldFromCards(null, lastActCardContent, characterCards, storyFolder);
		log(`World file generated (${result.length} chars)`);
	}
	return result;
}

async function readAndSaveActCards(
	storyFolder: string,
	formData: ImportFormData,
	log: (message: string) => void
): Promise<{ actNumber: number; content: string }[]> {
	const actCards: { actNumber: number; content: string }[] = [];

	for (const [index, act] of formData.acts.entries()) {
		if (!act.actFile) continue;
		const content = await act.actFile.text();
		if (!content) continue;

		const actNumber = index + 1;
		const actCard = { actNumber: actNumber, content };
		actCards.push(actCard);
		await saveActCard(storyFolder, actNumber, content);
		log(`Act card saved: ${act.actFile.name}`);
	}

	return actCards;
}

async function loadCharacterCards(
	characters: { id: string; name: string; cardFile: File | null }[],
	log: (msg: string) => void
): Promise<{ name: string; content: string }[]> {
	const characterCards: { name: string; content: string }[] = [];
	for (const char of characters) {
		if (char.cardFile) {
			const content = await char.cardFile.text();
			const name = char.name.trim() || extractCharacterName(content) || importWorldUnnamedCharacter();
			characterCards.push({ name, content });
			log(`Character loaded: ${name}`);
		}
	}
	return characterCards;
}

async function createMessagesFromParsed(
	parsedMessages: ParsedMessage[],
	actLineId: string,
	log: (msg: string) => void,
	onProgress?: (message: string) => void
): Promise<string[]> {
	const sceneNumbers = assignSceneNumbers(parsedMessages);
	let sequence = 1;
	const messageIds: string[] = [];
	const total = parsedMessages.length;
	const reportInterval = Math.max(1, Math.floor(total / 5));

	for (let i = 0; i < parsedMessages.length; i++) {
		const msg = parsedMessages[i];

		if (msg.role === 'system') {
			continue;
		}

		const messageId = crypto.randomUUID();

		try {
			await createMessage({
				id: messageId,
				role: msg.role,
				content: msg.content,
				reasoning: msg.reasoning,
				metadata: msg.metadata,
				variables: msg.variables ?? undefined,
				sceneNumber: sceneNumbers.get(i),
			});

			await addMessageToLine(actLineId, messageId, sequence++);
			messageIds.push(messageId);
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			log(`Failed to save message ${sequence}: ${errorMsg}`);
			throw e;
		}

		if (onProgress && sequence % reportInterval === 0) {
			onProgress(`Saving messages: ${sequence}/${total}`);
		}
	}

	log(`Saved ${sequence - 1} messages to act line`);
	return messageIds;
}

export function assignSceneNumbers(messages: { role: string; removed?: boolean }[]): Map<number, number> {
	const result = new Map<number, number>();
	let currentScene = 1;

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === 'system' || msg.removed) continue;

		result.set(i, currentScene);

		if (msg.role === 'user') {
			const nextAssistant = messages.findIndex((m, j) => j > i && m.role === 'assistant' && !m.removed);
			if (nextAssistant !== -1) {
				currentScene++;
			}
		}
	}

	return result;
}

async function saveCharacterCards(
	storyFolder: string,
	characterCards: { name: string; content: string }[],
	log: (msg: string) => void
): Promise<void> {
	if (characterCards.length === 0) return;

	const charactersDir = `${storyFolder}/characters`;

	const usedNames = new Set<string>();
	for (const card of characterCards) {
		let canonicalName = kebabCase(card.name);
		if (!canonicalName) {
			canonicalName = 'unnamed-character';
		}

		if (usedNames.has(canonicalName)) {
			let counter = 1;
			while (usedNames.has(`${canonicalName}-${counter}`)) {
				counter++;
			}
			canonicalName = `${canonicalName}-${counter}`;
		}
		usedNames.add(canonicalName);

		const filePath = `${charactersDir}/${canonicalName}.md`;
		await fileFs.writeTextFileEnsuringDir(filePath, card.content);
		log(`Character card saved: ${canonicalName}.md`);
	}
}

async function saveActCard(storyFolder: string, actNumber: number, content: string): Promise<void> {
	const filePath = `${storyFolder}/act-${actNumber}/act-card.md`;
	await fileFs.writeTextFileEnsuringDir(filePath, content);
}

function extractCharacterName(content: string): string | null {
	const coreIdentityHeader = characterCardCoreIdentityLabel();

	const descriptors: OutputDescriptor[] = [
		{
			outputPath: 'name',
			match: { type: 'list_labeled_item', content: nameLabel(), parent: { type: 'header', content: coreIdentityHeader } },
			bodyOnly: true,
		},
	];

	const result = parseContent<{ name: string | null }>(content, descriptors);
	return result.name;
}

async function cleanupImport(resources: CreatedResources, logs: string[]): Promise<void> {
	const safeDelete = async (fn: () => Promise<void>, label: string) => {
		try {
			await fn();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			logs.push(`  Warning: Failed to delete ${label}: ${msg}`);
		}
	};

	for (const msgId of resources.messageIds) {
		await safeDelete(() => deleteMessage(msgId), `message ${msgId.slice(-8)}`);
	}

	for (const lineId of resources.actLineIds) {
		await safeDelete(() => deleteLineEntries(lineId), `line entries for ${lineId.slice(-8)}`);
		await safeDelete(() => deleteActLine(lineId), `act line ${lineId.slice(-8)}`);
	}

	for (const actId of resources.actIds) {
		await safeDelete(() => deleteAct(actId), `act ${actId.slice(-8)}`);
	}

	if (resources.storyFolder && resources.storyId) {
		const storyId = resources.storyId;
		await safeDelete(() => deleteStoryFolder(storyId), `story folder`);
	}

	if (resources.storyId) {
		const storyId = resources.storyId;
		await safeDelete(() => deleteStory(storyId), `story ${storyId.slice(-8)}`);
	}

	logs.push('Cleanup complete.');
}
