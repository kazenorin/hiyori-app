import * as dbStories from '$lib/db/stories';
import * as dbActs from '$lib/db/acts';
import * as dbActLines from '$lib/db/act-lines';
import * as dbAppState from '$lib/db/app-state';
import { loadStorySystemPrompt, ensureWorldFile } from '$lib/fs/story-prompts';

export type { dbStories as Story, dbActs as Act, dbActLines as ActLineMeta };

let stories = $state<dbStories.Story[]>([]);
let acts = $state<dbActs.Act[]>([]);
let actLines = $state<dbActLines.ActLineMeta[]>([]);
let activeStoryId = $state<string | null>(null);
let activeActId = $state<string | null>(null);
let activeActLineId = $state<string | null>(null);
let isLoading = $state(true);
let isSelectingStory = $state(false);
let activeSystemPrompt = $state<string | null>(null);

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

export async function selectStory(storyId: string | null): Promise<void> {
	isSelectingStory = true;
	activeStoryId = storyId;
	activeActId = null;
	activeActLineId = null;
	acts = [];
	actLines = [];
	await dbAppState.setActiveStory(storyId);

	if (storyId) {
		await loadActs(storyId);
		const story = stories.find((s) => s.id === storyId);
		if (story) {
			activeSystemPrompt = await loadStorySystemPrompt(storyId, story.name);
			await ensureWorldFile(storyId, story.name);
		}
	}
	isSelectingStory = false;
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
}

export async function createStory(name: string): Promise<dbStories.Story> {
	const story = await dbStories.createStory(crypto.randomUUID(), name);
	stories = [story, ...stories];
	return story;
}

export async function createAct(
	storyId: string,
	name: string,
	continuesFromActLineId?: string
): Promise<dbActs.Act> {
	const actNumber = await dbActs.getNextActNumber(storyId);
	const act = await dbActs.createAct(
		crypto.randomUUID(),
		storyId,
		name,
		actNumber,
		continuesFromActLineId ?? null
	);
	acts = [...acts, act].sort((a, b) => a.actNumber - b.actNumber);
	return act;
}

export async function createActLine(actId: string, name: string): Promise<dbActLines.ActLineMeta> {
	const line = await dbActLines.createActLine(crypto.randomUUID(), actId, name);
	actLines = [...actLines, line];
	return line;
}

export async function deleteStory(id: string): Promise<void> {
	await dbStories.deleteStory(id);
	stories = stories.filter((s) => s.id !== id);
	if (activeStoryId === id) {
		activeStoryId = null;
		activeActId = null;
		activeActLineId = null;
		acts = [];
		actLines = [];
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

export async function restoreState(): Promise<void> {
	const state = await dbAppState.getAppState();
	if (state.activeStoryId) {
		activeStoryId = state.activeStoryId;
		await loadActs(state.activeStoryId);
		const story = stories.find((s) => s.id === state.activeStoryId);
		if (story) {
			activeSystemPrompt = await loadStorySystemPrompt(story.id, story.name);
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
