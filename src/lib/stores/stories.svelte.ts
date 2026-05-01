import * as dbStories from '$lib/db/stories';
import * as dbActs from '$lib/db/acts';
import * as dbActLines from '$lib/db/act-lines';
import * as dbAppState from '$lib/db/app-state';
import { log } from '$lib/logging/logger';
import { moveWorldBuilderLog } from '$lib/logging/chat-logger';
import { getLogFilePath } from '$lib/ai/world-builder.svelte';
import { Memory } from '$lib/memory/memory';
import { getMemoryProviderConfig, settings } from '$lib/stores/settings.svelte';
import type { ModelMessage } from 'ai';
import { loadStorySystemPrompt, loadStoryGeneralInstructions, loadSystemPrompt, loadGeneralInstructions } from '$lib/fs/prompts';
import { loadStoryWorldContent, ensureWorldFile, resolveStoryFolder, renameStoryFolder, deriveStoryName } from '$lib/fs/story-folders';
import { writeTextFile, readTextFile, exists, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
import * as dbStoryFolders from '$lib/db/story-folders';
import { buildLineDir } from '$lib/ai/card-output-path';
import { generateActPlot } from '$lib/ai/act-plot-generator';

export type { dbStories as Story, dbActs as Act, dbActLines as ActLineMeta };

let stories = $state<dbStories.Story[]>([]);
let acts = $state<dbActs.Act[]>([]);
let actLines = $state<dbActLines.ActLineMeta[]>([]);
let activeStoryId = $state<string | null>(null);
let activeStoryName = $state<string | null>(null);
let activeActId = $state<string | null>(null);
let activeActLineId = $state<string | null>(null);
let isLoading = $state(true);
let isSelectingStory = $state(false);
let activeSystemPrompt = $state<string | null>(null);
let activeGeneralInstructions = $state<string | null>(null);
let activeWorldContent = $state<string | null>(null);
let activeInterviewTranscript = $state<ModelMessage[]>([]);
let activeActPlotContent = $state<string>('');
let activeActSummary = $state<string>('');

export function getStories(): dbStories.Story[] {
	return stories;
}
export function getActs(): dbActs.Act[] {
	return acts;
}
export function getActLines(): dbActLines.ActLineMeta[] {
	return actLines;
}
export function getActiveStoryId(): string | null {
	return activeStoryId;
}
export function getActiveStoryName(): string | null {
	return activeStoryName;
}
export function getActiveActId(): string | null {
	return activeActId;
}
export function getActiveActLineId(): string | null {
	return activeActLineId;
}
export function getIsLoading(): boolean {
	return isLoading;
}
export function getIsSelectingStory(): boolean {
	return isSelectingStory;
}
export function getActiveSystemPrompt(): string | null {
	return activeSystemPrompt;
}
export async function getActiveSystemPromptOrDefault(): Promise<string> {
	return activeSystemPrompt ?? (await loadSystemPrompt());
}
export function getActiveGeneralInstructions(): string | null {
	return activeGeneralInstructions;
}
export async function getActiveGeneralInstructionsOrDefault(): Promise<string> {
	return activeGeneralInstructions ?? (await loadGeneralInstructions());
}
export function getActiveWorldContent(): string | null {
	return activeWorldContent;
}
export function getActiveActPlotContent(): string {
	return activeActPlotContent;
}
/** Set the active act plot content. Only updates when an act line is currently selected. */
export function setActiveActPlotContent(content: string): void {
	if (activeActLineId) {
		activeActPlotContent = content;
	}
}
export function getActiveActSummary(): string {
	return activeActSummary;
}
/**
 * Combined narration context as message array.
 * This is what gets prepended as hidden messages on every AI call.
 */
export function getActiveNarrationContext(): ModelMessage[] {
	const result: ModelMessage[] = [];
	const world = activeWorldContent;

	if (world) {
		result.push({ role: 'user', content: `The following is the world setting of the game story:\n\n---\n\n${world}` });
	}

	const interview = activeInterviewTranscript;
	if (interview.length > 0 && interview.some((m) => m.role === 'user')) {
		const act = acts.find((a) => a.id === activeActId);
		const actNumber = act?.actNumber ?? 1;
		result.push({
			role: 'user',
			content: `The following is an interview transcript on the premises about the current game act (Act ${actNumber}):`,
		});
		result.push(...interview);
		result.push({ role: 'user', content: 'That was the end of the interview transcript.' });
	}

	if (result.length > 0) {
		const act = acts.find((a) => a.id === activeActId);
		const actNumber = act?.actNumber ?? 1;
		result.push({ role: 'user', content: `Gamemaster, it is Act ${actNumber} now. Start the game.` });
	}

	return result;
}

export function getActiveStory(): dbStories.Story | null {
	return stories.find((s) => s.id === activeStoryId) ?? null;
}

export function getActiveAct(): dbActs.Act | null {
	return acts.find((a) => a.id === activeActId) ?? null;
}

export function getActiveActLine(): dbActLines.ActLineMeta | null {
	return actLines.find((l) => l.id === activeActLineId) ?? null;
}

export async function loadStories(): Promise<void> {
	stories = await dbStories.getAllStories();
}

export async function loadActs(storyId: string): Promise<void> {
	acts = await dbActs.getActsForStory(storyId);
}

export async function loadActLines(actId: string): Promise<void> {
	actLines = await dbActLines.getActLinesForAct(actId);
}

/**
 * Load story-specific content (system prompt, world content).
 * Shared between selectStory and restoreState to ensure consistent behavior.
 */
async function loadStoryContent(storyId: string, storyName: string): Promise<void> {
	activeSystemPrompt = await loadStorySystemPrompt(storyId, storyName);
	activeGeneralInstructions = await loadStoryGeneralInstructions(storyId, storyName);
	await ensureWorldFile(storyId, storyName);
	activeWorldContent = await loadStoryWorldContent(storyId, storyName);
}

function resetStoryContent(): void {
	activeSystemPrompt = null;
	activeGeneralInstructions = null;
	activeWorldContent = null;
	activeInterviewTranscript = [];
	activeActPlotContent = '';
	activeActSummary = '';
}

export async function selectStory(storyId: string | null): Promise<void> {
	isSelectingStory = true;
	activeStoryId = storyId;
	activeActId = null;
	activeActLineId = null;
	acts = [];
	actLines = [];

	try {
		await dbAppState.setActiveStory(storyId);

		if (storyId) {
			await loadActs(storyId);
			const story = stories.find((s) => s.id === storyId);
			if (story) {
				await loadStoryContent(storyId, story.name);
				activeStoryName = story.name;
			}
		} else {
			resetStoryContent();
		}
	} finally {
		isSelectingStory = false;
	}
}

export async function selectAct(actId: string | null): Promise<void> {
	activeActId = actId;
	activeActLineId = null;
	actLines = [];
	await dbAppState.setActiveAct(actId);

	if (actId) {
		await loadActLines(actId);
	}
}

export async function selectActLine(actLineId: string | null): Promise<void> {
	activeActLineId = actLineId;
	await dbAppState.setActiveActLine(actLineId);

	if (actLineId) {
		try {
			const premises = await dbActLines.getPremisesMessages(actLineId);
			activeInterviewTranscript = premises
				.filter((m) => m.role === 'user' || m.role === 'assistant')
				.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
		} catch {
			activeInterviewTranscript = [];
		}
		await loadActPlotAndSummary();
	} else {
		activeInterviewTranscript = [];
		activeActPlotContent = '';
		activeActSummary = '';
	}
}

/**
 * Load act plot content from file and latest act summary from DB messages.
 */
async function loadActPlotAndSummary(): Promise<void> {
	activeActPlotContent = '';
	activeActSummary = '';

	if (!activeStoryId || !activeActLineId || !activeStoryName) return;

	try {
		// Load act plot file
		const storyFolder = await resolveStoryFolder(activeStoryId, activeStoryName);
		const act = acts.find((a) => a.id === activeActId);
		const actLine = actLines.find((l) => l.id === activeActLineId);
		if (act && actLine) {
			const lineDir = buildLineDir(storyFolder, act.actNumber, actLine.isMainLine, actLine.id);
			const plotPath = `${lineDir}/act-plot.md`;
			const plotExists = await exists(plotPath, { baseDir: BaseDirectory.AppData });
			if (plotExists) {
				activeActPlotContent = await readTextFile(plotPath, { baseDir: BaseDirectory.AppData });
			} else {
				// Generate act plot if it doesn't exist yet
				const result = await generateActPlot(
					activeStoryId,
					activeStoryName,
					activeWorldContent ?? '',
					activeActLineId,
					actLine.isMainLine,
					act.actNumber
				);
				activeActPlotContent = result.content;
			}
		}
	} catch {
		// Act plot file may not exist yet
	}

	try {
		// Load latest act summary from DB messages
		const dbMsgs = await dbActLines.getMessagesForLine(activeActLineId);
		for (let i = dbMsgs.length - 1; i >= 0; i--) {
			if (dbMsgs[i].actSummary) {
				activeActSummary = dbMsgs[i].actSummary!;
				return;
			}
		}
	} catch {
		// Summary may not exist yet
	}
}

export async function createStory(name: string): Promise<dbStories.Story> {
	const story = await dbStories.createStory(crypto.randomUUID(), name);
	stories = [story, ...stories];
	return story;
}

export async function createAct(storyId: string, name: string, continuesFromActLineId?: string): Promise<dbActs.Act> {
	const actNumber = await dbActs.getNextActNumber(storyId);
	const act = await dbActs.createAct(crypto.randomUUID(), storyId, name, actNumber, continuesFromActLineId ?? null);
	acts = [...acts, act].sort((a, b) => a.actNumber - b.actNumber);
	return act;
}

export async function createActLine(actId: string, name: string): Promise<dbActLines.ActLineMeta> {
	const isFirst = actLines.length === 0;
	const line = await dbActLines.createActLine(crypto.randomUUID(), actId, name, isFirst);
	actLines = [...actLines, line];
	return line;
}

export async function renameStory(id: string, newName: string): Promise<void> {
	await dbStories.updateStory(id, newName);
	stories = stories.map((s) => (s.id === id ? { ...s, name: newName, updatedAt: Date.now() } : s));
	try {
		await renameStoryFolder(id, newName);
	} catch (err) {
		await log.error('story', 'Failed to rename folder', err);
	}
}

export async function renameAct(id: string, newName: string): Promise<void> {
	await dbActs.updateAct(id, newName);
	acts = acts.map((a) => (a.id === id ? { ...a, name: newName, updatedAt: Date.now() } : a));
}

export async function renameActLine(id: string, newName: string): Promise<void> {
	await dbActLines.updateActLine(id, newName);
	actLines = actLines.map((l) => (l.id === id ? { ...l, name: newName } : l));
}

export async function deleteStory(id: string, removeFolder: boolean = false): Promise<void> {
	await dbStories.deleteStory(id);
	stories = stories.filter((s) => s.id !== id);
	if (removeFolder) {
		const folderName = await dbStoryFolders.getStoryFolder(id);
		if (folderName) {
			try {
				await remove(folderName, { baseDir: BaseDirectory.AppData, recursive: true });
			} catch {
				// Folder may already be gone
			}
			await dbStoryFolders.deleteStoryFolder(id);
		}
	}
	if (activeStoryId === id) {
		activeStoryId = null;
		activeStoryName = null;
		activeActId = null;
		activeActLineId = null;
		acts = [];
		actLines = [];
		resetStoryContent();
		await dbAppState.setActiveStory(null);
	}
}

export async function deleteAct(id: string): Promise<void> {
	await dbActs.deleteAct(id);
	acts = acts.filter((a) => a.id !== id);
	if (activeActId === id) {
		activeActId = null;
		activeActLineId = null;
		actLines = [];
		await dbAppState.setActiveAct(null);
	}
}

export async function deleteActLine(id: string): Promise<void> {
	await dbActLines.deleteActLine(id);
	actLines = actLines.filter((l) => l.id !== id);
	if (activeActLineId === id) {
		activeActLineId = null;
		await dbAppState.setActiveActLine(null);
	}
}

export async function forkActLine(fromLineId: string, fromSequence: number, actId: string, name: string): Promise<dbActLines.ActLineMeta> {
	const newLineId = crypto.randomUUID();
	const line = await dbActLines.branchFromLine(newLineId, fromLineId, fromSequence, actId, name);
	actLines = [...actLines, line];
	await selectActLine(line.id);

	await copyMemoriesForFork(fromLineId, line.id, fromSequence);

	return line;
}

async function copyMemoriesForFork(fromLineId: string, toLineId: string, fromSequence: number): Promise<void> {
	const storyId = activeStoryId;
	if (!storyId || !settings.memoryEnabled) return;

	const config = getMemoryProviderConfig();
	if (!config) return;

	try {
		const messageIds = await dbActLines.getMessageIdsUpToSequence(fromLineId, fromSequence);
		if (messageIds.length === 0) return;

		const memory = new Memory(config);
		const result = await memory.copyMemoriesForFork(storyId, fromLineId, toLineId, messageIds);
		log.info(
			'fork',
			`Copied ${result.memoriesCopied} memories, ${result.locationsCopied} locations, ${result.aliasesCopied} aliases to line ${toLineId}`
		);
	} catch (err) {
		log.error('fork', 'Failed to copy memories for fork', err);
	}
}

export async function restoreState(): Promise<void> {
	const state = await dbAppState.getAppState();
	if (state.activeStoryId) {
		activeStoryId = state.activeStoryId;

		// Must load stories list before looking up the active story
		await loadStories();
		await loadActs(state.activeStoryId);

		const story = stories.find((s) => s.id === state.activeStoryId);
		if (story) {
			await loadStoryContent(story.id, story.name);
			activeStoryName = story.name;
		}
	}
	if (state.activeActId) {
		activeActId = state.activeActId;
		await loadActLines(state.activeActId);
	}
	if (state.activeActLineId) {
		activeActLineId = state.activeActLineId;
	}
	isLoading = false;
}

export async function createStoryFromWorldBuilder(name: string, worldContent: string): Promise<void> {
	const story = await createStory(name);
	const act = await createAct(story.id, 'Act 1');
	const actLine = await createActLine(act.id, 'main line');

	// Write world.md to story folder before selectStory triggers ensureWorldFile
	const effectiveName = deriveStoryName(story.name, story.id);
	const folderName = await resolveStoryFolder(story.id, effectiveName);
	const worldPath = `${folderName}/world.md`;
	await writeTextFile(worldPath, worldContent, { baseDir: BaseDirectory.AppData });

	// Move world builder log from AppData/logs/ to story folder
	const logFile = getLogFilePath();
	if (logFile) {
		await moveWorldBuilderLog(logFile, folderName);
	}

	await selectStory(story.id);
	await selectActLine(actLine.id);
}
