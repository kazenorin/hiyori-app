import { getMainProviderConfig, type ProviderConfig, settings } from '$lib/stores/settings.svelte';
import { resumeStoryActPrefix, resumeStoryActSuffix, worldBuilderSeed } from '$lib/features/world-builder/prompts';
import { sceneWithNumberLabel } from '$lib/definitions/common-labels';
import { actInformationHeader, charactersHeader, currentSceneHeader } from '$lib/definitions/common-headers';
import { loadLocaleStrings, ls } from '$lib/localization';
import {
	loadActPlotInterviewExtractionPrompt,
	loadActPlotInterviewSystemPrompt,
	loadGeneralInstructions,
	loadWorldBuilderSystemPrompt,
	loadWorldTemplate,
} from '$lib/fs/prompts';
import { setActiveLocale } from '$lib/fs/prompt-loader';
import { generateWorldBuilderLogFilename, logWorldBuilderChat } from '$lib/logging/chat-logger';
import { log } from '$lib/logging/logger';
import { type StreamAccumulator, type StreamState } from '$lib/ai/chat-callbacks';
import { streamChatResponse } from '$lib/ai/chat-stream';
import type { MessageBase } from '$lib/db/messages';
import * as dbMessages from '$lib/db/messages';
import * as dbActLines from '$lib/db/act-lines';
import { ERR_API_KEY_AND_MODEL_NOT_CONFIGURED } from '$lib/definitions/error-messages';

export interface WorldBuilderMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

export interface ForkInterviewContext {
	actSummary: string;
	narrativeBody: string;
	sceneNumber: number;
	sceneTitle: string;
}

export interface NewActInterviewContext {
	endingType: string;
	actSummary: string;
}

const COMPLETION_MARKER = '[WORLD_BUILDER_COMPLETE]';

const seedMsg = () => ({ role: 'user' as const, content: worldBuilderSeed() });

let isActive = $state(false);
let messages = $state<WorldBuilderMessage[]>([]);
let isStreaming = $state(false);
let error = $state<string | null>(null);
let storyName = $state<string | null>(null);
let worldContent = $state<string | null>(null);
let isComplete = $state(false);
let abortController: AbortController | null = null;
let logFilePath: string | null = null;

// Act-plot interview state
let actPlotInterview = $state(false);
let gameResumeInterview = $state(false);
let interviewActLineId: string | null = null;
let interviewHiddenContext: MessageBase[] = [];

const hasInterviewMessages = $derived(messages.some((m) => m.role === 'user') || interviewHiddenContext.length > 1);
let interviewWorldContent: string | null = null;

// Cached prompts loaded once on enter
let cachedWorldBuilderPrompt: string | null = null;
let cachedWorldTemplate: string | null = null;
let cachedInterviewSystemPrompt: string | null = null;

export function getIsActive(): boolean {
	return isActive;
}
export function getMessages(): WorldBuilderMessage[] {
	return messages;
}
export function getIsStreaming(): boolean {
	return isStreaming;
}
export function getError(): string | null {
	return error;
}
export function getStoryName(): string | null {
	return storyName;
}
export function getWorldContent(): string | null {
	return actPlotInterview ? interviewWorldContent : worldContent;
}
export function getIsComplete(): boolean {
	return isComplete;
}
export function getLogFilePath(): string | null {
	return logFilePath;
}
export function getActPlotInterview(): boolean {
	return actPlotInterview;
}
export function getHasInterviewMessages(): boolean {
	return hasInterviewMessages;
}
export function getGameResumeInterview(): boolean {
	return gameResumeInterview;
}
export function getInterviewActLineId(): string | null {
	return interviewActLineId;
}
export function getIsNextActInterview(): boolean {
	return actPlotInterview && !gameResumeInterview;
}

async function loadActiveLocales() {
	// Set active locale to i18n locale for world builder session
	setActiveLocale(settings.locale || 'en');
	await loadLocaleStrings(settings.locale || 'en');
}

function resetState(): void {
	isActive = false;
	messages = [];
	isStreaming = false;
	error = null;
	storyName = null;
	worldContent = null;
	isComplete = false;
	abortController = null;
	logFilePath = null;
	cachedWorldBuilderPrompt = null;
	cachedWorldTemplate = null;
	cachedInterviewSystemPrompt = null;
	actPlotInterview = false;
	gameResumeInterview = false;
	interviewActLineId = null;
	interviewHiddenContext = [];
	interviewWorldContent = null;
}

export function exitWorldBuilderMode(): void {
	if (abortController) {
		abortController.abort();
	}
	resetState();
}

function buildFullWorldBuildPrompt(): string {
	return (cachedWorldBuilderPrompt ?? '') + '\n\n---\n\n' + (cachedWorldTemplate ?? '') + '\n\n---\n\n';
}

/**
 * Pure function to extract completion data from content.
 * Returns { storyName, worldContent } or null if no marker found.
 */
export function extractCompletionData(content: string): { storyName: string; worldContent: string } | null {
	const markerIndex = content.indexOf(COMPLETION_MARKER);
	if (markerIndex === -1) return null;

	const afterMarker = content.slice(markerIndex + COMPLETION_MARKER.length).trim();
	const lines = afterMarker.split('\n');

	const extractedName = (lines[0] ?? '').trim() || 'Untitled Story';
	const extractedContent = lines.slice(1).join('\n').trim();

	if (!extractedContent) return null;
	return { storyName: extractedName, worldContent: extractedContent };
}

function parseCompletionMarker(content: string): void {
	const result = extractCompletionData(content);
	if (result) {
		storyName = result.storyName;
		worldContent = result.worldContent;
		isComplete = true;
	}
}

export async function enterWorldBuilderMode(): Promise<void> {
	exitWorldBuilderMode();
	isActive = true;
	logFilePath = generateWorldBuilderLogFilename();

	// Load and cache prompts once (now uses locale-scoped dirs)
	const [worldBuilderPrompt, worldTemplate] = await Promise.all([loadWorldBuilderSystemPrompt(), loadWorldTemplate()]);
	cachedWorldBuilderPrompt = worldBuilderPrompt;
	cachedWorldTemplate = worldTemplate;

	await streamNextResponse();
}

export interface InterviewAdditionalContext {
	actCard?: string;
	characterCards?: { name: string; content: string }[];
}

export async function enterActPlotInterviewMode(
	actLineId: string,
	worldContent: string,
	forkContext?: ForkInterviewContext,
	additionalContext?: InterviewAdditionalContext,
	newActContext?: NewActInterviewContext
): Promise<void> {
	// Reset world builder state but keep isActive true
	resetState();
	isActive = true;
	actPlotInterview = true;
	interviewActLineId = actLineId;
	interviewWorldContent = worldContent;

	// Load interview system prompt with general instructions injected and interview extraction prompt
	const [generalInstructions, interviewSystemPrompt, interviewPrompt] = await Promise.all([
		loadGeneralInstructions(),
		loadActPlotInterviewSystemPrompt(),
		loadActPlotInterviewExtractionPrompt(),
	]);

	const interviewSystemRole = newActContext ? ls('features.interview.systemRole.nextAct') : ls('features.interview.systemRole.preGame');

	// Inject general instructions and system role into the interview system prompt and cache it
	cachedInterviewSystemPrompt = interviewSystemPrompt
		.replace('{generalInstructions}', generalInstructions)
		.replace('{interviewSystemRole}', interviewSystemRole);

	// Build hidden context (invisible to user, sent to LLM every turn)
	interviewHiddenContext = [{ role: 'user', content: interviewPrompt.replace('{worldContent}', worldContent) }];

	if (additionalContext) {
		if (additionalContext.actCard) {
			interviewHiddenContext.push({ role: 'user', content: `## ${actInformationHeader()}\n\n${additionalContext.actCard}` });
		}
		if (additionalContext.characterCards && additionalContext.characterCards.length > 0) {
			const cardsContent = additionalContext.characterCards.map((c) => `### ${c.name}\n\n${c.content}`).join('\n\n');
			interviewHiddenContext.push({ role: 'user', content: `## ${charactersHeader()}\n\n${cardsContent}` });
		}
	}

	if (newActContext) {
		const conclusionSection = ls('features.interview.previousActConclusion', { endingType: newActContext.endingType });
		interviewHiddenContext.push({ role: 'user', content: `${conclusionSection}\n\n${newActContext.actSummary}` });
		const purposeSection = ls('features.interview.nextActInterviewPurpose', { endingType: newActContext.endingType });
		interviewHiddenContext.push({ role: 'user', content: purposeSection });
	}

	// When forking, include act summary so the interview
	// LLM knows the story state prior to the fork point
	if (forkContext) {
		gameResumeInterview = true;
		const hasSceneContext = forkContext.sceneNumber && forkContext.sceneTitle && forkContext.narrativeBody;

		if (forkContext.actSummary || hasSceneContext) {
			const sections: string[] = [resumeStoryActPrefix()];

			if (forkContext.actSummary) {
				sections.push(`\n\n${forkContext.actSummary}`);
			}
			if (hasSceneContext) {
				const sceneLabel = sceneWithNumberLabel(forkContext.sceneNumber);
				sections.push(`\n\n${sceneLabel}: ${forkContext.sceneTitle} *(${currentSceneHeader()})*\n\n${forkContext.narrativeBody}`);
			}

			sections.push(resumeStoryActSuffix());
			return await sendWorldBuilderMessage(sections.join(''));
		}
	}

	await streamNextResponse();
}

export async function sendWorldBuilderMessage(text: string): Promise<void> {
	error = null;

	const userMessage: WorldBuilderMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		content: text,
	};

	await streamNextResponse(userMessage);
}

export function stopStreaming(): void {
	abortController?.abort();
}

export async function regenerateLastWorldBuilderResponse(): Promise<void> {
	if (isStreaming) return;

	const lastMessageIdx = messages.map((m) => m.role).lastIndexOf('assistant');
	if (lastMessageIdx === -1) return;

	const lastAssistant = messages[lastMessageIdx];
	messages = messages.filter((m) => m.id !== lastAssistant.id);

	await streamNextResponse();
}

export async function deleteLastWorldBuilderExchange(): Promise<void> {
	if (isStreaming) return;

	const lastMessageIdx = messages.map((m) => m.role).lastIndexOf('assistant');
	if (lastMessageIdx === -1) {
		// No assistant message — remove last user message if any
		const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
		if (lastUserIdx === -1) return;
		messages = messages.filter((_, i) => i !== lastUserIdx);
		return;
	}

	const lastUserIdx = messages
		.slice(0, lastMessageIdx)
		.map((m) => m.role)
		.lastIndexOf('user');
	if (lastUserIdx === -1) {
		messages = messages.filter((_, i) => i !== lastMessageIdx);
		return;
	}

	messages = messages.filter((_, i) => i !== lastUserIdx && i !== lastMessageIdx);
}

async function streamNextResponse(userMessage?: WorldBuilderMessage): Promise<void> {
	const providerConfig = getMainProviderConfig();
	if (!providerConfig?.apiKey || !providerConfig?.model) {
		error = ERR_API_KEY_AND_MODEL_NOT_CONFIGURED;
		return;
	}

	await loadActiveLocales();

	const responseMessage: WorldBuilderMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
	if (userMessage) {
		messages = [...messages, userMessage, responseMessage];
	} else {
		messages = [...messages, responseMessage];
	}

	const messageIdx = messages.length - 1;
	function getCurrentMessage(): WorldBuilderMessage {
		return messages[messageIdx];
	}

	isStreaming = true;
	abortController = new AbortController();

	try {
		const existingMsgs = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
		const history = actPlotInterview ? existingMsgs : [seedMsg(), ...existingMsgs];
		await streamWorldBuilderChat(history, messageIdx, abortController.signal, providerConfig);
		parseCompletionMarker(getCurrentMessage().content);

		// Persist messages to DB when in interview mode
		if (actPlotInterview && interviewActLineId) {
			await persistInterviewMessages(userMessage, getCurrentMessage());
		}
	} catch (err: unknown) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			// Persist partial content on abort in interview mode
			if (actPlotInterview && interviewActLineId) {
				const partial = getCurrentMessage();
				if (partial?.content) {
					await persistInterviewMessages(userMessage, partial);
				}
			}
			return;
		}
		error = err instanceof Error ? err.message : 'An unexpected error occurred.';
		messages = messages.filter((m) => m.id !== responseMessage.id);
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

async function persistInterviewMessages(
	userMessage: WorldBuilderMessage | undefined,
	assistantMessage: WorldBuilderMessage
): Promise<void> {
	if (!interviewActLineId) return;

	try {
		if (userMessage) {
			await dbMessages.createMessage({ id: userMessage.id, role: userMessage.role, content: userMessage.content });
			const userSeq = await dbActLines.getNextPremisesSequence(interviewActLineId);
			await dbActLines.addMessageToPremises(interviewActLineId, userMessage.id, userSeq);
		}

		if (assistantMessage.content) {
			await dbMessages.createMessage({ id: assistantMessage.id, role: 'assistant', content: assistantMessage.content });
			const assistantSeq = await dbActLines.getNextPremisesSequence(interviewActLineId);
			await dbActLines.addMessageToPremises(interviewActLineId, assistantMessage.id, assistantSeq);
		}
	} catch (err) {
		await log.error('interview', 'Failed to persist interview messages', err);
	}
}

/**
 * Remove the last persisted assistant message from act_line_premises.
 * Called before starting the game so the GM's final "ready to start" message
 * doesn't pollute the interview transcript used for act-plot generation.
 */
export async function removeLastInterviewAssistantMessage(): Promise<void> {
	if (!interviewActLineId) return;

	const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
	if (!lastAssistant) return;

	await dbActLines.removeMessagesFromPremises(interviewActLineId, [lastAssistant.id]);
}

async function streamWorldBuilderChat(
	history: MessageBase[],
	messageIdx: number,
	abortSignal: AbortSignal,
	providerConfig: ProviderConfig
): Promise<StreamAccumulator> {
	const fullSystemPrompt = actPlotInterview && cachedInterviewSystemPrompt ? cachedInterviewSystemPrompt : buildFullWorldBuildPrompt();
	// Prepend hidden context for interview mode (invisible to user, but sent to LLM)
	const llmHistory = actPlotInterview ? [...interviewHiddenContext, ...history] : history;
	const result = await Promise.all([
		logWorldBuilderChat({
			systemPrompt: fullSystemPrompt,
			messages: llmHistory,
			logFilename: logFilePath ?? undefined,
		}),
		streamChatResponse(
			fullSystemPrompt,
			llmHistory,
			abortSignal,
			(state: StreamState) => {
				messages[messageIdx] = { ...messages[messageIdx], content: state.content };
			},
			() => {},
			providerConfig
		),
	]);
	return result[1];
}
