import * as dbStories from '$lib/db/stories';
import * as dbActs from '$lib/db/acts';
import * as dbActLines from '$lib/db/act-lines';
import * as dbAppState from '$lib/db/app-state';
import * as dbDirectorNotes from '$lib/db/director-notes';
import { log } from '$lib/logging/logger';
import { moveWorldBuilderLog } from '$lib/logging/chat-logger';
import { getLogFilePath } from '$lib/features/world-builder/world-builder.svelte';
import { Memory } from '$lib/features/memory';
import { getMemoryProviderConfig, settings } from '$lib/stores/settings.svelte';
import type { ModelMessage } from 'ai';
import { loadStorySystemPrompt, loadSystemPrompt } from '$lib/fs/prompts';
import { setActiveLocale } from '$lib/fs/prompt-loader';
import { loadLocaleStrings } from '$lib/localization';
import { loadStoryWorldContent, ensureWorldFile, resolveStoryFolder, renameStoryFolder, deriveStoryName } from '$lib/fs/story-folders';
import { writeTextFile, readTextFile, exists, remove, copyFile, mkdir, rename, BaseDirectory } from '@tauri-apps/plugin-fs';
import * as dbStoryFolders from '$lib/db/story-folders';
import { buildLineDir, buildLineSubdirSuffix, computeLineSubdir, getLineDir, resolveLineSubdir } from '$lib/ai/card-output-path';
import { generateActPlot, type ActPlotPhase } from '$lib/ai/act-plot-generator';

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
let activeWorldContent = $state<string | null>(null);
let activeInterviewTranscript = $state<ModelMessage[]>([]);
let activeActPlotContent = $state<string>('');
let actPlotGenerationPhase = $state<ActPlotPhase | null>(null);
let activeDirectorNotes = $state<dbDirectorNotes.DirectorNote[]>([]);

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
export function getActPlotGenerationPhase(): ActPlotPhase | null {
	return actPlotGenerationPhase;
}
export function setActPlotGenerationPhase(phase: ActPlotPhase | null): void {
	actPlotGenerationPhase = phase;
}
export function getActiveDirectorNotes(): dbDirectorNotes.DirectorNote[] {
	return activeDirectorNotes;
}
export function getActiveDirectorNotesText(currentScene: number): string {
	const active = activeDirectorNotes.filter((n) => {
		if (!n.isActive) return false;
		if (n.effectiveFromScene !== null && currentScene < n.effectiveFromScene) return false;
		if (n.effectiveToScene !== null && currentScene > n.effectiveToScene) return false;
		return true;
	});
	if (active.length === 0) return '';
	return active.map((n, i) => `${i + 1}. ${n.text}`).join('\n');
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
	await ensureWorldFile(storyId, storyName);
	activeWorldContent = await loadStoryWorldContent(storyId, storyName);
}

function resetStoryContent(): void {
	activeSystemPrompt = null;
	activeWorldContent = null;
	activeInterviewTranscript = [];
	activeActPlotContent = '';
	activeDirectorNotes = [];
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
				setActiveLocale(story.locale || 'en');
				await loadLocaleStrings(story.locale || 'en', story.id, story.name);
			}
		} else {
			resetStoryContent();
			setActiveLocale(settings.locale || 'en');
			await loadLocaleStrings(settings.locale || 'en');
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
		await ensureActPlot();
		activeDirectorNotes = await dbDirectorNotes.getDirectorNotes(actLineId);
	} else {
		activeInterviewTranscript = [];
		activeActPlotContent = '';
		activeDirectorNotes = [];
	}
}

/**
 * Ensure the act plot file exists (generating it if needed) and load its content.
 */
async function ensureActPlot(): Promise<void> {
	activeActPlotContent = '';

	if (!activeStoryId || !activeActLineId || !activeStoryName) return;

	try {
		// Load act plot file
		const storyFolder = await resolveStoryFolder(activeStoryId, activeStoryName);
		const act = acts.find((a) => a.id === activeActId);
		const actLine = actLines.find((l) => l.id === activeActLineId);
		if (act && actLine) {
			const lineDir = await getLineDir(storyFolder, act.actNumber, actLine.isMainLine, actLine.id);
			const plotPath = `${lineDir}/act-plot.md`;
			const plotExists = await exists(plotPath, { baseDir: BaseDirectory.AppData });
			if (plotExists) {
				activeActPlotContent = await readTextFile(plotPath, { baseDir: BaseDirectory.AppData });
			} else {
				// Generate act plot if it doesn't exist yet
				const result = await generateActPlot({
					storyId: activeStoryId,
					storyName: activeStoryName,
					worldContent: activeWorldContent ?? '',
					actLineId: activeActLineId,
					isMainLine: actLine.isMainLine,
					actNumber: act.actNumber,
					onPhaseChange: (phase) => {
						actPlotGenerationPhase = phase;
					},
				});
				activeActPlotContent = result.content;
				actPlotGenerationPhase = null;
			}
		}
	} catch {
		actPlotGenerationPhase = null;
	}
}

export async function createStory(name: string, locale: string): Promise<dbStories.Story> {
	const story = await dbStories.createStory(crypto.randomUUID(), name, locale);
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

	// Rename folder on disk to match new name
	const storyId = activeStoryId;
	const storyName = stories.find((s) => s.id === storyId)?.name;
	const act = acts.find((a) => a.id === activeActId);
	if (storyId && storyName && act) {
		try {
			const storyFolder = await resolveStoryFolder(storyId, storyName);
			const actDir = `${storyFolder}/act-${act.actNumber}`;
			const oldSubdir = await resolveLineSubdir(actDir, id);
			if (oldSubdir) {
				const newSubdir = computeLineSubdir(false, id, buildLineSubdirSuffix(newName));
				if (oldSubdir !== newSubdir) {
					await rename(`${actDir}/${oldSubdir}`, `${actDir}/${newSubdir}`, {
						oldPathBaseDir: BaseDirectory.AppData,
						newPathBaseDir: BaseDirectory.AppData,
					});
				}
			}
		} catch (err) {
			await log.error('act-line', 'Failed to rename act line folder', err);
		}
	}
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

export async function deleteActLine(id: string, removeFolder: boolean = false): Promise<void> {
	// Read metadata before DB deletion (needed for folder path construction)
	const line = actLines.find((l) => l.id === id);
	const act = line ? acts.find((a) => a.id === line.actId) : null;
	const storyId = activeStoryId;
	const storyName = activeStoryName;

	// Perform full DB cleanup (act_line_meta + junctions + orphaned messages)
	await dbActLines.deleteActLine(id);
	await dbDirectorNotes.deleteDirectorNotesForActLine(id);

	// Remove folder if requested
	if (removeFolder && line && act && storyId && storyName) {
		try {
			const storyFolder = await resolveStoryFolder(storyId, storyName);
			const lineDir = await getLineDir(storyFolder, act.actNumber, line.isMainLine, line.id);
			await remove(lineDir, { baseDir: BaseDirectory.AppData, recursive: true });
		} catch (err) {
			await log.error('delete-act-line', 'Failed to remove line folder', err);
		}
	}

	actLines = actLines.filter((l) => l.id !== id);
	if (activeActLineId === id) {
		activeActLineId = null;
		await dbAppState.setActiveActLine(null);
	}
}

export async function addDirectorNote(text: string, effectiveFromScene?: number | null, effectiveToScene?: number | null): Promise<void> {
	if (!activeActLineId) return;
	const id = crypto.randomUUID();
	await dbDirectorNotes.createDirectorNote(id, activeActLineId, text, effectiveFromScene, effectiveToScene);
	activeDirectorNotes = [
		...activeDirectorNotes,
		{ id, actLineId: activeActLineId, text, isActive: true, effectiveFromScene: effectiveFromScene ?? null, effectiveToScene: effectiveToScene ?? null, createdAt: Date.now() },
	];
}

export async function updateDirectorNote(id: string, fields: { text?: string; isActive?: boolean; effectiveFromScene?: number | null; effectiveToScene?: number | null }): Promise<void> {
	await dbDirectorNotes.updateDirectorNote(id, fields);
	activeDirectorNotes = activeDirectorNotes.map((n) => (n.id === id ? { ...n, ...fields } : n));
}

export async function deleteDirectorNote(id: string): Promise<void> {
	await dbDirectorNotes.deleteDirectorNote(id);
	activeDirectorNotes = activeDirectorNotes.filter((n) => n.id !== id);
}

export async function forkActLine(fromLineId: string, fromSequence: number, actId: string, name: string): Promise<dbActLines.ActLineMeta> {
	const newLineId = crypto.randomUUID();
	const { lineMeta, remappedMessageIds } = await dbActLines.branchFromLine(newLineId, fromLineId, fromSequence, actId, name);
	actLines = [...actLines, lineMeta];

	// Copy act-plot file from source to forked line before selectActLine triggers ensureActPlot
	await copyActPlotForFork(fromLineId, lineMeta.id);
	await dbDirectorNotes.cloneDirectorNotes(fromLineId, lineMeta.id);

	await selectActLine(lineMeta.id);

	await copyMemoriesForFork(fromLineId, lineMeta.id, fromSequence, remappedMessageIds);

	return lineMeta;
}

/**
 * Copy the act-plot.md file from the source act line to the forked line.
 * This prevents ensureActPlot from regenerating the act-plot via LLM.
 */
async function copyActPlotForFork(fromLineId: string, toLineId: string): Promise<void> {
	const storyId = activeStoryId;
	const storyName = activeStoryName;
	if (!storyId || !storyName) return;

	const act = acts.find((a) => a.id === activeActId);
	if (!act) return;

	const fromLine = actLines.find((l) => l.id === fromLineId);
	const toLine = actLines.find((l) => l.id === toLineId);
	if (!fromLine || !toLine) return;

	try {
		const storyFolder = await resolveStoryFolder(storyId, storyName);
		const fromDir = await getLineDir(storyFolder, act.actNumber, fromLine.isMainLine, fromLineId);
		const toDir = buildLineDir(storyFolder, act.actNumber, false, toLineId, buildLineSubdirSuffix(toLine.name));
		const fromPath = `${fromDir}/act-plot.md`;
		const toPath = `${toDir}/act-plot.md`;

		if (await exists(fromPath, { baseDir: BaseDirectory.AppData })) {
			await mkdir(toDir, { baseDir: BaseDirectory.AppData, recursive: true });
			await copyFile(fromPath, toPath, { fromPathBaseDir: BaseDirectory.AppData, toPathBaseDir: BaseDirectory.AppData });
		}
	} catch (err) {
		await log.error('fork', 'Failed to copy act-plot for fork', err);
	}
}

/**
 * Fork an act line for the interview path: copies messages and premises,
 * but does NOT copy the act-plot file or select the line.
 * Call selectActLineQuiet after this to set the active line without
 * triggering act-plot generation.
 */
export async function forkActLineForInterview(
	fromLineId: string,
	fromSequence: number,
	actId: string,
	name: string
): Promise<dbActLines.ActLineMeta> {
	const newLineId = crypto.randomUUID();
	const { lineMeta, remappedMessageIds } = await dbActLines.branchFromLine(newLineId, fromLineId, fromSequence, actId, name);
	actLines = [...actLines, lineMeta];

	// Create the line directory with proper naming at fork time
	const storyId = activeStoryId;
	const storyName = activeStoryName;
	if (storyId && storyName) {
		const act = acts.find((a) => a.id === activeActId);
		const storyFolder = await resolveStoryFolder(storyId, storyName);
		if (act && storyFolder) {
			const lineDir = buildLineDir(storyFolder, act.actNumber, false, lineMeta.id, buildLineSubdirSuffix(name));
			await mkdir(lineDir, { baseDir: BaseDirectory.AppData, recursive: true });
		}
	}

	// Do NOT copy act-plot — it will be generated after the interview
	// Do NOT call selectActLine — it would trigger ensureActPlot

	await copyMemoriesForFork(fromLineId, lineMeta.id, fromSequence, remappedMessageIds);
	await dbDirectorNotes.cloneDirectorNotes(fromLineId, lineMeta.id);

	return lineMeta;
}

/**
 * Set the active act line and load premises, but skip act-plot generation.
 * Use before entering world-builder interview mode so the active line is
 * set correctly without triggering ensureActPlot.
 */
export async function selectActLineQuiet(actLineId: string): Promise<void> {
	activeActLineId = actLineId;
	await dbAppState.setActiveActLine(actLineId);

	try {
		const premises = await dbActLines.getPremisesMessages(actLineId);
		activeInterviewTranscript = premises
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
	} catch {
		activeInterviewTranscript = [];
	}

	// Intentionally skip ensureActPlot — act-plot will be generated after interview
	activeActPlotContent = '';
}

async function copyMemoriesForFork(
	fromLineId: string,
	toLineId: string,
	fromSequence: number,
	remappedMessageIds: Map<string, string>
): Promise<void> {
	const storyId = activeStoryId;
	if (!storyId || !settings.memoryEnabled) return;

	const config = getMemoryProviderConfig();
	if (!config) return;

	try {
		const messageIds = await dbActLines.getMessageIdsUpToSequence(fromLineId, fromSequence);
		if (messageIds.length === 0) return;

		// Remap message IDs: cloned messages on the forked line have new IDs
		const remappedIds = messageIds.map((id) => remappedMessageIds.get(id) ?? id);

		const memory = new Memory(config);
		const result = await memory.copyMemoriesForFork(storyId, fromLineId, toLineId, remappedIds);
		log.info(
			'fork',
			`Copied ${result.memoriesCopied} memories, ${result.locationsCopied} locations, ${result.aliasesCopied} aliases, ${result.inventoryCopied} inventory items to line ${toLineId}`
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
			setActiveLocale(story.locale || 'en');
			await loadLocaleStrings(story.locale || 'en', story.id, story.name);
		}
	}
	if (state.activeActId) {
		activeActId = state.activeActId;
		await loadActLines(state.activeActId);
	}
	if (state.activeActLineId) {
		activeActLineId = state.activeActLineId;
		await ensureActPlot();
	}
	isLoading = false;
}

export async function createStoryFromWorldBuilder(name: string, worldContent: string, locale: string): Promise<void> {
	const story = await createStory(name, locale);
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
