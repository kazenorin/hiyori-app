// Main import orchestrator coordinating all import steps

import { createStory, deleteStory } from '$lib/db/stories';
import { createAct, deleteAct } from '$lib/db/acts';
import { addMessageToLine, createActLine, deleteActLine, deleteLineEntries } from '$lib/db/act-lines';
import { getDefaultPlotMode } from '$lib/stores/settings.svelte';
import { createMessage, deleteMessage } from '$lib/db/messages';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { deleteStoryFolder } from '$lib/db/story-folders';
import { BaseDirectory, mkdir, writeTextFile } from '@tauri-apps/plugin-fs';
import { loadStories } from '$lib/stores/stories.svelte';
import { kebabCase } from 'lodash-es';
import type { ImportFormData, ImportProgressUpdate, ImportResult, ParsedMessage } from './types';
import { emptyVariables } from '$lib/ai/narrative-types';
import type { RetryConfig } from '$lib/ai/chat-stream';
import { parseTranscriptFile } from './transcript-parsers';
import { runGameDataDetection } from './game-data-detector';
import { generateWorldFromCards } from '$lib/ai/world-generator';
import { ls } from '$lib/localization';
import { nameLabel } from '$lib/definitions/common-labels';
import { parseContent, type OutputDescriptor } from '$lib/utils/chat-stream-parser';

// === Progress Callback Type ===

export type ProgressCallback = (update: ImportProgressUpdate) => void;

// === Main Import Function ===

export async function executeImport(formData: ImportFormData, onProgress: ProgressCallback): Promise<ImportResult> {
	const warnings: string[] = [];
	const logs: string[] = [];

	function log(message: string): void {
		logs.push(message);
		onProgress({
			phase: 'creating-story',
			message,
			consoleOutput: logs.join('\n'),
		});
	}

	// Track created resources for cleanup on failure
	const createdResources = {
		storyId: null as string | null,
		storyFolder: null as string | null,
		actIds: [] as string[],
		actLineIds: [] as string[],
		messageIds: [] as string[],
	};

	let worldContent: string | null = null;
	let storyFolder = '';
	let storyId = '';
	let storyName = '';

	try {
		// Phase: Creating Story
		log('Creating story...');
		storyId = crypto.randomUUID();
		storyName = formData.storyName.trim() || `Story-${storyId.slice(-8)}`;

		await createStory(storyId, storyName, 'en');
		createdResources.storyId = storyId;
		log(`Story created: "${storyName}" (${storyId.slice(-8)})`);

		// Refresh sidebar to show new story
		await loadStories();

		// Resolve story folder
		storyFolder = await resolveStoryFolder(storyId, storyName);
		createdResources.storyFolder = storyFolder;

		// Save world file if provided
		if (formData.worldFile) {
			worldContent = await formData.worldFile.text();
			const worldPath = `${storyFolder}/world.md`;
			await writeTextFile(worldPath, worldContent, { baseDir: BaseDirectory.AppData });
			log(`World file saved: ${formData.worldFile.name}`);
		}

		// Load character cards
		const characterCards = await loadCharacterCards(formData.characters, log);

		// Save character cards to disk
		await saveCharacterCards(storyFolder, characterCards, log);

		// Process acts
		const processResult = await processActs(
			formData,
			storyId,
			storyFolder,
			worldContent,
			characterCards,
			log,
			onProgress,
			createdResources
		);

		// Generate world.md from cards if not provided
		if (!worldContent) {
			const lastAct = formData.acts.length > 0 ? formData.acts[formData.acts.length - 1] : null;
			const actCardContent = lastAct?.actFile ? await lastAct.actFile.text() : null;

			if (actCardContent || characterCards.length > 0) {
				log('Generating world file from provided cards...');
				worldContent = await generateWorldFromCards(null, actCardContent, characterCards, storyFolder);
				log(`World file generated (${worldContent.length} chars)`);
			}
		}

		// Refresh sidebar again to show updated names
		await loadStories();

		// Finalize
		onProgress({
			phase: 'complete',
			message: processResult.needsInterview
				? ls('features.importWorld.messages.importCompleteWithInterview')
				: ls('features.importWorld.messages.importComplete'),
			consoleOutput: logs.join('\n') + '\n\n✓ ' + ls('features.importWorld.messages.importCompletedSuccessfully'),
		});

		const firstActId = processResult.actIds.length > 0 ? processResult.actIds[0] : undefined;
		const lastActId = processResult.actIds.length > 0 ? processResult.actIds[processResult.actIds.length - 1] : undefined;
		const lastActLineId = processResult.actLineIds.length > 0 ? processResult.actLineIds[processResult.actLineIds.length - 1] : undefined;

		return {
			success: true,
			storyId,
			actId: firstActId,
			lastActId,
			actLineId: lastActLineId,
			warnings,
			importComplete: true,
			needsInterview: processResult.needsInterview,
			worldContent: worldContent ?? undefined,
			interviewContext: processResult.needsInterview
				? {
						actCard: processResult.interviewActCard,
						characterCards,
					}
				: undefined,
		};
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logs.push(`\n✗ Import failed: ${errorMsg}`);

		// Cleanup created resources on failure
		logs.push('Cleaning up partially imported data...');
		await cleanupImport(createdResources, logs);

		onProgress({
			phase: 'error',
			message: ls('features.importWorld.messages.importFailed'),
			errorMessage: errorMsg,
			consoleOutput: logs.join('\n'),
		});

		return {
			success: false,
			error: errorMsg,
			warnings,
			importComplete: false,
		};
	}
}

// === Act Processing ===

interface ActProcessingResult {
	actIds: string[];
	actLineIds: string[];
	needsInterview: boolean;
	interviewActCard: string | null;
}

async function processActs(
	formData: ImportFormData,
	storyId: string,
	storyFolder: string,
	worldContent: string | null,
	characterCards: { name: string; content: string }[],
	log: (msg: string) => void,
	onProgress: ProgressCallback,
	createdResources: CreatedResources
): Promise<ActProcessingResult> {
	let previousActLineId: string | null = null;
	const actIds: string[] = [];
	const actLineIds: string[] = [];
	let needsInterview = false;
	let interviewActCard: string | null = null;

	const retryConfig: RetryConfig = {
		retryCount: formData.retryCount,
		backoffIntervalSeconds: formData.backoffIntervalSeconds,
	};

	for (let actIndex = 0; actIndex < formData.acts.length; actIndex++) {
		const actInput = formData.acts[actIndex];
		const actNumber = actIndex + 1;
		const isLastAct = actIndex === formData.acts.length - 1;

		const { actId, actLineId } = await createActAndLine(actInput, actNumber, storyId, previousActLineId, log, onProgress, createdResources);
		actIds.push(actId);
		actLineIds.push(actLineId);

		if (actInput.transcript) {
			await processTranscriptAct(
				actInput,
				actLineId,
				storyFolder,
				actNumber,
				formData.skipOptionalMalformed,
				retryConfig,
				log,
				onProgress,
				createdResources
			);
		} else if (isLastAct) {
			if (actInput.actFile) {
				const actCardContent = await actInput.actFile.text();
				await saveActCard(storyFolder, actNumber, actCardContent);
				log(`Act card saved: ${actInput.actFile.name}`);
				interviewActCard = actCardContent;
			}
			needsInterview = true;
		}

		previousActLineId = actLineId;
	}

	return { actIds, actLineIds, needsInterview, interviewActCard };
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
		message: ls('features.importWorld.messages.processingAct', { actNumber }),
		consoleOutput: '',
	});

	// Create act with placeholder name if needed
	const actId = crypto.randomUUID();
	const placeholderName = isPlaceholderName ? `Act-${actId.slice(-8)}` : actInput.name.trim();
	await createAct(actId, storyId, placeholderName, actNumber, previousActLineId);
	createdResources.actIds.push(actId);
	log(`Act ${actNumber} created: "${placeholderName}"`);

	// Create main act line
	const actLineId = crypto.randomUUID();
	await createActLine(actLineId, actId, 'Main Line', true, getDefaultPlotMode());
	createdResources.actLineIds.push(actLineId);

	return { actId, actLineId };
}

async function processTranscriptAct(
	actInput: { id: string; name: string; actFile: File | null; transcript: File | null },
	actLineId: string,
	storyFolder: string,
	actNumber: number,
	skipOptionalMalformed: boolean,
	retryConfig: RetryConfig,
	log: (msg: string) => void,
	onProgress: ProgressCallback,
	createdResources: CreatedResources
): Promise<void> {
	// Parse transcript
	const transcriptName = actInput.transcript!.name;
	log(`Parsing transcript: ${transcriptName}`);

	const parsedTranscript = await parseTranscriptFile(actInput.transcript!, skipOptionalMalformed);

	const parsedMessages = [...parsedTranscript.messages];

	log(`Parsed ${parsedMessages.length} messages (${parsedTranscript.format} format)`);

	// Run game data detection on assistant messages lacking game data
	const missingGameData = parsedTranscript.messages.filter((m) => m.role === 'assistant' && !m.gameData).length;

	if (missingGameData > 0) {
		onProgress({
			phase: 'saving-messages',
			message: ls('features.importWorld.messages.detectingGameData', { count: missingGameData }),
			consoleOutput: '',
		});
		log(`Detecting game data for ${missingGameData} messages...`);

		const detectionResult = await runGameDataDetection(
			parsedMessages,
			retryConfig,
			log,
			(msgIndex, state) => {
				const consoleOutput = state.content ? state.content : state.reasoning;
				onProgress({
					phase: 'generating-game-data',
					message: ls('features.importWorld.messages.generatingGameData', { index: msgIndex }),
					consoleOutput: consoleOutput ?? '',
				});
			},
			(msgIndex, err, attempt) => {
				const errorContent = `[generating-game-data] attempt ${attempt + 1} failed: ${err.message}. Retrying...`;
				onProgress({
					phase: 'generating-game-data',
					message: ls('features.importWorld.messages.generatingGameData', { index: msgIndex }),
					consoleOutput: '[ERROR]' + errorContent,
				});
			}
		);

		// Use the updated messages with detected game data
		for (const result of detectionResult.results) {
			if (result.gameData) {
				const originalParsedMessage = parsedMessages[result.messageIndex];
				parsedMessages[result.messageIndex] = {
					...originalParsedMessage,
					gameData: result.gameData,
					metadata: result.metadata ?? originalParsedMessage.metadata,
				};
			}
		}

		const detected = detectionResult.results.filter((r) => r.gameData).length;
		const llmCalls = detectionResult.llmCallsMade;
		log(`Game data detection: ${detected}/${missingGameData} messages processed (${llmCalls} LLM calls)`);
	}

	// Create messages and add to act line
	const messageIds = await createMessagesFromParsed(parsedMessages, actLineId, log, (msg) => {
		onProgress({
			phase: 'saving-messages',
			message: msg,
			consoleOutput: '',
		});
	});
	createdResources.messageIds.push(...messageIds);

	// Save provided act card if exists (for transcript imports)
	if (actInput.actFile) {
		const actCardContent = await actInput.actFile.text();
		await saveActCard(storyFolder, actNumber, actCardContent);
		log(`Act card saved: ${actInput.actFile.name}`);
	}
}

// === Helper Functions ===

async function loadCharacterCards(
	characters: { id: string; name: string; cardFile: File | null }[],
	log: (msg: string) => void
): Promise<{ name: string; content: string }[]> {
	const characterCards: { name: string; content: string }[] = [];
	for (const char of characters) {
		if (char.cardFile) {
			const content = await char.cardFile.text();
			const name = char.name.trim() || extractCharacterName(content) || ls('features.importWorld.description.unnamedCharacter');
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
	let sequence = 1;
	const messageIds: string[] = [];
	const total = parsedMessages.length;
	const reportInterval = Math.max(1, Math.floor(total / 5)); // Report every 20%

	for (const msg of parsedMessages) {
		// Skip non-supported roles
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
				variables: msg.gameData ? { ...emptyVariables(), gameData: msg.gameData } : undefined,
			});

			await addMessageToLine(actLineId, messageId, sequence++);
			messageIds.push(messageId);
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			log(`Failed to save message ${sequence}: ${errorMsg}`);
			throw e; // Re-throw to trigger cleanup
		}

		// Report progress periodically for large batches
		if (onProgress && sequence % reportInterval === 0) {
			onProgress(`Saving messages: ${sequence}/${total}`);
		}
	}

	log(`Saved ${sequence - 1} messages to act line`);
	return messageIds;
}

async function saveCharacterCards(
	storyFolder: string,
	characterCards: { name: string; content: string }[],
	log: (msg: string) => void
): Promise<void> {
	if (characterCards.length === 0) return;

	const charactersDir = `${storyFolder}/characters`;
	await mkdir(charactersDir, { baseDir: BaseDirectory.AppData, recursive: true });

	const usedNames = new Set<string>();
	for (const card of characterCards) {
		// Use canonical kebab-case naming like character-card-generator
		let canonicalName = kebabCase(card.name);
		if (!canonicalName) {
			canonicalName = 'unnamed-character';
		}

		// Handle collisions by appending counter
		if (usedNames.has(canonicalName)) {
			let counter = 1;
			while (usedNames.has(`${canonicalName}-${counter}`)) {
				counter++;
			}
			canonicalName = `${canonicalName}-${counter}`;
		}
		usedNames.add(canonicalName);

		const filePath = `${charactersDir}/${canonicalName}.md`;
		await writeTextFile(filePath, card.content, { baseDir: BaseDirectory.AppData });
		log(`Character card saved: ${canonicalName}.md`);
	}
}

async function saveActCard(storyFolder: string, actNumber: number, content: string): Promise<void> {
	const actDir = `${storyFolder}/act-${actNumber}`;
	await mkdir(actDir, { baseDir: BaseDirectory.AppData, recursive: true });

	const filePath = `${actDir}/act-card.md`;
	await writeTextFile(filePath, content, { baseDir: BaseDirectory.AppData });
}

function extractCharacterName(content: string): string | null {
	const coreIdentityHeader = ls('features.characterCardGenerator.coreIdentity');

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

interface CreatedResources {
	storyId: string | null;
	storyFolder: string | null;
	actIds: string[];
	actLineIds: string[];
	messageIds: string[];
}

async function cleanupImport(resources: CreatedResources, logs: string[]): Promise<void> {
	// Helper to safely delete and log failures
	const safeDelete = async (fn: () => Promise<void>, label: string) => {
		try {
			await fn();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			logs.push(`  Warning: Failed to delete ${label}: ${msg}`);
		}
	};

	// Delete messages (reverse order - no dependencies)
	for (const msgId of resources.messageIds) {
		await safeDelete(() => deleteMessage(msgId), `message ${msgId.slice(-8)}`);
	}

	// Delete act lines and their entries
	for (const lineId of resources.actLineIds) {
		await safeDelete(() => deleteLineEntries(lineId), `line entries for ${lineId.slice(-8)}`);
		await safeDelete(() => deleteActLine(lineId), `act line ${lineId.slice(-8)}`);
	}

	// Delete acts
	for (const actId of resources.actIds) {
		await safeDelete(() => deleteAct(actId), `act ${actId.slice(-8)}`);
	}

	// Delete story folder (files)
	if (resources.storyFolder && resources.storyId) {
		const storyId = resources.storyId;
		await safeDelete(() => deleteStoryFolder(storyId), `story folder`);
	}

	// Delete story (must be last - it's the root)
	if (resources.storyId) {
		const storyId = resources.storyId;
		await safeDelete(() => deleteStory(storyId), `story ${storyId.slice(-8)}`);
	}

	logs.push('Cleanup complete.');
}
