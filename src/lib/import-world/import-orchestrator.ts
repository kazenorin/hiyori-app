// Main import orchestrator coordinating all import steps

import { createStory } from '$lib/db/stories';
import { createAct } from '$lib/db/acts';
import { createActLine, addMessageToLine } from '$lib/db/act-lines';
import { createMessage } from '$lib/db/messages';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { writeTextFile, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import type {
	ImportFormData,
	ImportResult,
	ImportProgressUpdate,
	ParsedMessage,
	RetryConfig
} from './types';
import { parseTranscriptFile } from './transcript-parsers';
import { generateActFromCards } from './act-generator';

// === Progress Callback Type ===

export type ProgressCallback = (update: ImportProgressUpdate) => void;

// === Main Import Function ===

export async function executeImport(
	formData: ImportFormData,
	onProgress: ProgressCallback
): Promise<ImportResult> {
	const warnings: string[] = [];

	try {
		// Phase: Creating Story
		onProgress({ phase: 'creating-story', message: 'Creating story...' });
		const storyId = crypto.randomUUID();
		const storyName = formData.storyName.trim() || `Story-${storyId.slice(-8)}`;

		// Create story in database
		await createStory(storyId, storyName);

		// Resolve story folder
		const storyFolder = await resolveStoryFolder(storyId, storyName);

		// Save world file if provided
		let worldContent: string | null = null;
		if (formData.worldFile) {
			worldContent = await formData.worldFile.text();
			const worldPath = `${storyFolder}/world.md`;
			await writeTextFile(worldPath, worldContent, { baseDir: BaseDirectory.AppData });
		}

		// Load character cards
		const characterCards: { name: string; content: string }[] = [];
		for (const char of formData.characters) {
			if (char.cardFile) {
				const content = await char.cardFile.text();
				const name = char.name.trim() || extractCharacterName(content) || 'Unknown Character';
				characterCards.push({ name, content });
			}
		}

		// Save character cards to disk
		await saveCharacterCards(storyFolder, characterCards);

		// Process each act
		let previousActLineId: string | null = null;
		const actIds: string[] = [];
		const actLineIds: string[] = [];

		for (let actIndex = 0; actIndex < formData.acts.length; actIndex++) {
			const actInput = formData.acts[actIndex];
			const actNumber = actIndex + 1;

			onProgress({
				phase: 'processing-act',
				message: `Processing Act ${actNumber}...`,
				details: `Act ${actNumber} of ${formData.acts.length}`
			});

			// Create act
			const actId = crypto.randomUUID();
			const actName = actInput.name.trim() || `Act ${actNumber}`;
			await createAct(actId, storyId, actName, actNumber, previousActLineId);
			actIds.push(actId);

			// Create main act line
			const actLineId = crypto.randomUUID();
			await createActLine(actLineId, actId, 'Main Line', true);
			actLineIds.push(actLineId);

			// Process act content
			if (actInput.transcript) {
				// Parse transcript
				onProgress({
					phase: 'processing-act',
					message: `Parsing transcript for Act ${actNumber}...`,
					consoleOutput: `Reading transcript file: ${actInput.transcript.name}`
				});

				const parsedTranscript = await parseTranscriptFile(
					actInput.transcript,
					formData.skipOptionalMalformed
				);

				onProgress({
					phase: 'processing-act',
					message: `Parsed ${parsedTranscript.messages.length} messages from transcript`,
					consoleOutput: `Detected format: ${parsedTranscript.format}`
				});

				// Create messages and add to act line
				await createMessagesFromParsed(
					parsedTranscript.messages,
					actLineId,
					onProgress
				);

				// Save provided act card if exists (for transcript imports)
				if (actInput.actFile) {
					const actCardContent = await actInput.actFile.text();
					await saveActCard(storyFolder, actNumber, actCardContent);
				}
			} else if (actInput.actFile) {
				// Load act card content
				const actCardContent = await actInput.actFile.text();

				// Generate act via LLM
				onProgress({
					phase: 'generating-act',
					message: `Generating Act ${actNumber} via LLM...`,
					isStreaming: true
				});

				const retryConfig: RetryConfig = {
					retryCount: formData.retryCount,
					backoffIntervalSeconds: formData.backoffIntervalSeconds
				};

				const generation = await generateActFromCards(
					worldContent,
					actCardContent,
					characterCards,
					retryConfig,
					(text) => {
						onProgress({
							phase: 'generating-act',
							message: `Generating Act ${actNumber}...`,
							consoleOutput: text.slice(-500), // Last 500 chars
							isStreaming: true
						});
					}
				);

				// Parse generated content into messages
				const generatedMessages: ParsedMessage[] = [
					{ role: 'assistant', content: generation }
				];

				await createMessagesFromParsed(generatedMessages, actLineId, onProgress);

				// Save generated content as act card
				await saveActCard(storyFolder, actNumber, generation);
			} else if (worldContent || characterCards.length > 0) {
				// Generate from world + characters only
				onProgress({
					phase: 'generating-act',
					message: `Generating Act ${actNumber} from world settings...`,
					isStreaming: true
				});

				const retryConfig: RetryConfig = {
					retryCount: formData.retryCount,
					backoffIntervalSeconds: formData.backoffIntervalSeconds
				};

				const generation = await generateActFromCards(
					worldContent,
					null,
					characterCards,
					retryConfig,
					(text) => {
						onProgress({
							phase: 'generating-act',
							message: `Generating Act ${actNumber}...`,
							consoleOutput: text.slice(-500),
							isStreaming: true
						});
					}
				);

				const generatedMessages: ParsedMessage[] = [
					{ role: 'assistant', content: generation }
				];

				await createMessagesFromParsed(generatedMessages, actLineId, onProgress);

				// Save generated content as act card
				await saveActCard(storyFolder, actNumber, generation);
			}

			previousActLineId = actLineId;
		}

		// Finalize
		onProgress({ phase: 'finalizing', message: 'Finalizing story...' });
		onProgress({ phase: 'complete', message: 'Import complete!' });

		// Return first act info for navigation (guard against empty acts)
		const firstActId = actIds.length > 0 ? actIds[0] : undefined;
		const firstActLineId = actLineIds.length > 0 ? actLineIds[0] : undefined;

		return {
			success: true,
			storyId,
			actId: firstActId,
			actLineId: firstActLineId,
			warnings
		};
	} catch (error) {
		onProgress({
			phase: 'error',
			message: 'Import failed',
			details: error instanceof Error ? error.message : String(error)
		});

		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			warnings
		};
	}
}

// === Helper Functions ===

async function createMessagesFromParsed(
	parsedMessages: ParsedMessage[],
	actLineId: string,
	onProgress: ProgressCallback
): Promise<void> {
	let sequence = 1;

	for (const msg of parsedMessages) {
		// Skip non-supported roles
		if (msg.role === 'system') {
			// System messages are not saved as user-visible messages
			continue;
		}

		const messageId = crypto.randomUUID();
		await createMessage(
			messageId,
			msg.role,
			msg.content,
			msg.reasoning,
			msg.metadata,
			msg.gameData
		);

		await addMessageToLine(actLineId, messageId, sequence++);
	}

	onProgress({
		phase: 'saving-messages',
		message: `Saved ${sequence - 1} messages`,
		consoleOutput: `Created ${sequence - 1} messages in act line`
	});
}

async function saveCharacterCards(
	storyFolder: string,
	characterCards: { name: string; content: string }[]
): Promise<void> {
	if (characterCards.length === 0) return;

	const charactersDir = `${storyFolder}/characters`;
	await mkdir(charactersDir, { baseDir: BaseDirectory.AppData, recursive: true });

	const usedNames = new Set<string>();
	for (const card of characterCards) {
		let fileName = card.name.replace(/[^a-zA-Z0-9_-]/g, '_');
		// Handle collisions by appending counter
		if (usedNames.has(fileName)) {
			let counter = 1;
			while (usedNames.has(`${fileName}_${counter}`)) {
				counter++;
			}
			fileName = `${fileName}_${counter}`;
		}
		usedNames.add(fileName);

		const filePath = `${charactersDir}/${fileName}.md`;
		await writeTextFile(filePath, card.content, { baseDir: BaseDirectory.AppData });
	}
}

async function saveActCard(
	storyFolder: string,
	actNumber: number,
	content: string
): Promise<void> {
	const actDir = `${storyFolder}/act-${actNumber}`;
	await mkdir(actDir, { baseDir: BaseDirectory.AppData, recursive: true });

	const filePath = `${actDir}/act-card.md`;
	await writeTextFile(filePath, content, { baseDir: BaseDirectory.AppData });
}

function extractCharacterName(content: string): string | null {
	// Try to extract character name from card content
	// Look for patterns like "# Character Name" or "Name: ..."
	const headerMatch = content.match(/^#\s*(.+)$/m);
	if (headerMatch) {
		return headerMatch[1].trim();
	}

	const nameFieldMatch = content.match(/^Name:\s*(.+)$/m);
	if (nameFieldMatch) {
		return nameFieldMatch[1].trim();
	}

	return null;
}
