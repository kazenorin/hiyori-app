import { getMainProviderConfig, type ProviderConfig, settings } from '$lib/stores/settings.svelte';
import {
	resumeStoryActPrefix,
	resumeStoryActSuffix,
	worldBuilderExtractionPrompt,
	worldBuilderSeed,
} from '$lib/features/world-builder/prompts';
import { sceneWithNumberLabel } from '$lib/definitions/common-labels';
import { actInformationHeader, charactersHeader, currentSceneHeader } from '$lib/definitions/common-headers';
import {
	actPlotInterviewExtractionPrompt,
	interviewSystemRoleNextAct,
	interviewSystemRolePreGame,
	interviewPreviousActConclusion,
	interviewNextActPurpose,
} from '$lib/definitions/feature-prompts';
import { loadLocaleStrings } from '$lib/localization';
import {
	actPlotInterviewSystemPromptLoader,
	generalInstructionsLoader,
	worldBuilderSystemPromptLoader,
	worldPreTemplateDiscoveryLoader,
} from '$lib/fs/prompts';
import { setActiveLocale } from '$lib/fs/prompt-loader';
import { generateWorldBuilderLogFilename, logWorldBuilderChat } from '$lib/logging/chat-logger';
import { log } from '$lib/logging/logger';
import { type StreamAccumulator, type StreamState } from '$lib/ai/chat-callbacks';
import { streamChatResponse } from '$lib/ai/chat-stream';
import { computeTargetWordCountRange } from '$lib/ai/act-plot/target-word-count-parser';
import type { MessageBase } from '$lib/db/messages';
import * as dbMessages from '$lib/db/messages';
import * as dbActLines from '$lib/db/act-lines';
import { ERR_API_KEY_AND_MODEL_NOT_CONFIGURED } from '$lib/definitions/error-messages';
import { isAbortLikeError } from '$lib/utils/async';
import { getUserFacingErrorMessage } from '$lib/utils/error-handling';
import { ls } from '$lib/localization';
import { WORLD_TEMPLATES } from '$lib/features/world-builder/template-registry';
import { buildWorldBuilderTools } from '$lib/ai/tools/select-world-template';
import type { ToolSet } from 'ai';
import { getLineDir } from '$lib/ai/card-output-path';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { getActNumber } from '$lib/db/acts';
import { buildRequirementTools } from '$lib/ai/tools/record-requirement';
import { readRequirementsBlock, writeRequirementsBlock } from '$lib/fs/requirements-files';
import {
	appendRequirementLine,
	formatRequirementsContext,
	isDuplicateRequirement,
	type Requirement,
	type RequirementCategory,
} from '$lib/definitions/requirements';

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

/**
 * Used for continuing from an existing Act to a New Act
 */
export interface NewActInterviewContext {
	endingType: string;
	actSummary: string;
}

const seedMsg = () => ({ role: 'user' as const, content: worldBuilderSeed() });

let isActive = $state(false);
let messages = $state<WorldBuilderMessage[]>([]);
let isStreaming = $state(false);
let error = $state<string | null>(null);
let storyName = $state('');
let storyLocale = $state('');
let worldContent = $state<string | null>(null);
let readyToCreate = $state(false);
let isCompilingWorld = $state(false);
let abortController: AbortController | null = null;
let logFilePath: string | null = null;

// Act-plot interview state
let actPlotInterview = $state(false);
let gameResumeInterview = $state(false);
let isNextActContinuation = $state(false);
let interviewActLineId: string | null = null;
let interviewHiddenContext: MessageBase[] = [];

const hasInterviewMessages = $derived(messages.some((m) => m.role === 'user') || interviewHiddenContext.length > 1);
let interviewWorldContent: string | null = null;

// Cached prompts loaded once on enter
let cachedWorldBuilderPrompt: string | null = null;
let cachedInterviewSystemPrompt: string | null = null;

// World builder phase state
type WorldBuilderPhase = 'pre-template' | 'post-template';
let wbPhase: WorldBuilderPhase = $state('pre-template');
let selectedTemplateId: string | null = $state(null);

// Explicit requirements recorded via the record-requirement tool.
// World-builder set lives in memory; the act-plot set lives in a per-line sidecar.
let recordedRequirements = $state<Requirement[]>([]);
let interviewStory: { id: string; name: string } | null = null;
let cachedInterviewLineDir: string | null = null;

// Serializes act-plot sidecar read-modify-write. The AI SDK runs multiple tool calls from a
// single assistant turn concurrently, so without this chain two `record-requirement` calls
// would both read the same body and the second write would drop the first requirement.
let sidecarWriteChain: Promise<void> = Promise.resolve();

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
export function getStoryName(): string {
	return storyName.trim() || 'Untitled Story';
}
export function getStoryLocale(): string {
	return storyLocale;
}
export function getWorldContent(): string | null {
	return actPlotInterview ? interviewWorldContent : worldContent;
}
export function setStoryName(name: string): void {
	storyName = name;
}
export function setStoryLocale(locale: string): void {
	storyLocale = locale;
}
export function getReadyToCreate(): boolean {
	return readyToCreate;
}
export function getIsCompilingWorld(): boolean {
	return isCompilingWorld;
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
	return isNextActContinuation;
}

async function loadActiveLocales(storyLocale?: string, storyId?: string, storyName?: string) {
	const locale = storyLocale || settings.locale || 'en';
	setActiveLocale(locale);
	await loadLocaleStrings(locale, storyId, storyName);
}

function resetState(): void {
	isActive = false;
	messages = [];
	isStreaming = false;
	error = null;
	storyName = '';
	storyLocale = '';
	worldContent = null;
	readyToCreate = false;
	isCompilingWorld = false;
	abortController = null;
	logFilePath = null;
	cachedWorldBuilderPrompt = null;
	cachedInterviewSystemPrompt = null;
	wbPhase = 'pre-template';
	selectedTemplateId = null;
	actPlotInterview = false;
	gameResumeInterview = false;
	isNextActContinuation = false;
	interviewActLineId = null;
	interviewHiddenContext = [];
	interviewWorldContent = null;
	recordedRequirements = [];
	interviewStory = null;
	cachedInterviewLineDir = null;
}

export function exitWorldBuilderMode(): void {
	if (abortController) {
		abortController.abort();
	}
	resetState();
}

async function buildFullWorldBuildPrompt(): Promise<string> {
	if (wbPhase === 'pre-template') {
		const discoveryPrompt = await worldPreTemplateDiscoveryLoader.loadDefault();
		return (cachedWorldBuilderPrompt ?? '') + '\n\n---\n\n' + discoveryPrompt + '\n\n---\n\n';
	}
	const entry = WORLD_TEMPLATES.find((t) => t.id === selectedTemplateId);
	const templateContent = entry ? await entry.loader.loadDefault() : '';
	return (cachedWorldBuilderPrompt ?? '') + '\n\n---\n\n' + templateContent + '\n\n---\n\n';
}

export async function enterWorldBuilderMode(): Promise<void> {
	exitWorldBuilderMode();
	isActive = true;
	wbPhase = 'pre-template';
	selectedTemplateId = null;
	logFilePath = generateWorldBuilderLogFilename();

	await loadActiveLocales();

	cachedWorldBuilderPrompt = await worldBuilderSystemPromptLoader.loadDefault();

	await streamNextResponse();
}

export interface InterviewAdditionalContext {
	actCard?: string;
	characterCards?: { name: string; content: string }[];
}

export interface EnterActPlotInterviewModeParams {
	actLineId: string;
	worldContent: string;
	forkContext?: ForkInterviewContext;
	additionalContext?: InterviewAdditionalContext;
	newActContext?: NewActInterviewContext;
	story?: { id: string; name: string; locale: string };
	resumeFromPremises?: boolean;
}

export async function enterActPlotInterviewMode(params: EnterActPlotInterviewModeParams): Promise<void> {
	const { actLineId, worldContent, forkContext, additionalContext, newActContext, story, resumeFromPremises } = params;
	resetState();
	isActive = true;
	actPlotInterview = true;
	isNextActContinuation = !!newActContext;
	interviewActLineId = actLineId;
	interviewWorldContent = worldContent;
	interviewStory = story ? { id: story.id, name: story.name } : null;

	await loadActiveLocales(story?.locale, story?.id, story?.name);

	// Load interview system prompt with general instructions injected and interview extraction prompt
	const [generalInstructions, interviewSystemPrompt] = story
		? await Promise.all([
				generalInstructionsLoader.loadByStory(story.id, story.name),
				actPlotInterviewSystemPromptLoader.loadByStory(story.id, story.name),
			])
		: await Promise.all([generalInstructionsLoader.loadDefault(), actPlotInterviewSystemPromptLoader.loadDefault()]);

	const interviewPrompt = actPlotInterviewExtractionPrompt();

	const interviewSystemRole = newActContext ? interviewSystemRoleNextAct() : interviewSystemRolePreGame();

	// Inject general instructions and system role into the interview system prompt and cache it
	cachedInterviewSystemPrompt = interviewSystemPrompt
		.replace('{{generalInstructions}}', generalInstructions)
		.replace('{{interviewSystemRole}}', interviewSystemRole)
		.replace('{{targetWordCountRange}}', computeTargetWordCountRange(settings.targetWordCount));

	// Build hidden context (invisible to user, sent to LLM every turn)
	interviewHiddenContext = [{ role: 'user', content: interviewPrompt.replace('{{worldContent}}', worldContent) }];

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
		const conclusionSection = interviewPreviousActConclusion(newActContext.endingType);
		interviewHiddenContext.push({ role: 'user', content: `${conclusionSection}\n\n${newActContext.actSummary}` });
		const purposeSection = interviewNextActPurpose(newActContext.endingType);
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

	if (resumeFromPremises) {
		const premises = await dbActLines.getPremisesMessages(actLineId);
		if (premises.length > 0) {
			messages = premises.map((m) => ({ id: m.id, role: m.role, content: m.content }));
			return;
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

/**
 * Trigger the silent compile turn: sends a hidden user message asking the LLM
 * to produce the final world document, then on success captures the full
 * streamed response as `worldContent` and sets `readyToCreate=true`.
 *
 * Idempotent: if a compile is already in progress or completed, this is a no-op
 * (returns immediately when `isStreaming` or `readyToCreate` is true).
 *
 * To retry after a failure, the caller must first invoke `cancelStart()`.
 */
export async function requestStart(): Promise<void> {
	if (isStreaming || readyToCreate) return;
	isCompilingWorld = true;
	error = null;
	try {
		const compiled = await runHiddenCompileTurn();
		if (compiled) {
			worldContent = compiled;
			readyToCreate = true;
		}
	} finally {
		isCompilingWorld = false;
	}
}

/** Reset the ready-to-create gate so the user can re-compile after a failure. */
export function cancelStart(): void {
	if (readyToCreate) {
		readyToCreate = false;
		worldContent = null;
	}
}

async function handleTemplateSelected(templateId: string): Promise<string> {
	if (wbPhase !== 'pre-template' || selectedTemplateId !== null) {
		return ls('tools.selectWorldTemplate.messages.errors.alreadySelected');
	}

	const entry = WORLD_TEMPLATES.find((t) => t.id === templateId);
	if (!entry) {
		return ls('tools.selectWorldTemplate.messages.errors.invalidTemplateId');
	}

	selectedTemplateId = templateId;
	wbPhase = 'post-template';

	return ls('tools.selectWorldTemplate.messages.success', { templateName: entry.label() });
}

export function getWbPhase(): WorldBuilderPhase {
	return wbPhase;
}

export function getSelectedTemplateId(): string | null {
	return selectedTemplateId;
}

export function getRecordedRequirements(): Requirement[] {
	return recordedRequirements;
}

/** Lazily resolve and cache the act-line directory for the act-plot requirements sidecar. */
async function resolveInterviewLineDir(): Promise<string | null> {
	if (cachedInterviewLineDir) return cachedInterviewLineDir;
	if (!interviewActLineId || !interviewStory) return null;
	const actLine = await dbActLines.getActLine(interviewActLineId);
	if (!actLine) return null;
	const storyFolder = await resolveStoryFolder(interviewStory.id, interviewStory.name);
	const actNumber = (await getActNumber(actLine.actId)) ?? 1;
	cachedInterviewLineDir = await getLineDir(storyFolder, actNumber, actLine.isMainLine, actLine.id);
	return cachedInterviewLineDir;
}

/**
 * Append one requirement line to the act-plot sidecar, serialized against other in-flight
 * appends so concurrent `record-requirement` calls in a single turn can't drop a line.
 * The chain swallows each link's outcome so one failed write can't permanently block later
 * appends, while `await run` still propagates this call's own error to the caller.
 */
export async function appendRequirementToSidecar(lineDir: string, req: Requirement): Promise<void> {
	const run = sidecarWriteChain.then(async () => {
		const existing = await readRequirementsBlock(lineDir);
		await writeRequirementsBlock(lineDir, appendRequirementLine(existing, req));
	});
	sidecarWriteChain = run.catch(() => {});
	await run;
}

/**
 * Tool handler for `record-requirement`. In the act-plot interview the requirement is
 * appended to `{lineDir}/requirements.md` (durable source of truth, deduped against the
 * file). In the world-builder interview it is held in memory (deduped against the list)
 * and later injected into the compile turn + written to the story-level sidecar.
 */
export async function handleRecordRequirement(category: RequirementCategory, requirement: string): Promise<string> {
	const req: Requirement = { category, requirement };

	if (actPlotInterview) {
		const lineDir = await resolveInterviewLineDir();
		if (lineDir) {
			await appendRequirementToSidecar(lineDir, req);
		} else {
			await log.error('interview', 'Cannot resolve act-line directory; requirement not persisted to sidecar');
		}
		return ls('tools.recordRequirement.messages.success');
	}

	if (!isDuplicateRequirement(recordedRequirements, req)) {
		recordedRequirements = [...recordedRequirements, req];
	}
	return ls('tools.recordRequirement.messages.success');
}

async function runHiddenCompileTurn(): Promise<string | null> {
	if (isStreaming) return null;

	const providerConfig = getMainProviderConfig();
	if (!providerConfig?.model) {
		error = ERR_API_KEY_AND_MODEL_NOT_CONFIGURED;
		return null;
	}
	const existingMsgs: MessageBase[] = messages.map((m) => ({ role: m.role, content: m.content }));
	const requirementContext = formatRequirementsContext(recordedRequirements);
	const history: MessageBase[] = actPlotInterview
		? existingMsgs
		: [
				seedMsg(),
				...existingMsgs,
				...(requirementContext ? [{ role: 'user' as const, content: requirementContext }] : []),
				{ role: 'user', content: worldBuilderExtractionPrompt() },
			];
	let captured = '';
	isStreaming = true;
	abortController = new AbortController();

	try {
		await streamWorldBuilderChat(
			history,
			(state: StreamState) => {
				captured = state.content;
			},
			abortController.signal,
			providerConfig
		);
		return captured.trim() || null;
	} catch (err: unknown) {
		if (isAbortLikeError(err)) {
			return null;
		}
		error = getUserFacingErrorMessage(err);
		return null;
	} finally {
		isStreaming = false;
		abortController = null;
	}
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

export function updateWorldBuilderMessageContent(messageId: string, content: string): void {
	const idx = messages.findIndex((m) => m.id === messageId);
	if (idx === -1) return;
	messages[idx] = { ...messages[idx], content };
}

async function streamNextResponse(userMessage?: WorldBuilderMessage): Promise<void> {
	if (isStreaming) return;

	const providerConfig = getMainProviderConfig();
	if (!providerConfig?.model) {
		error = ERR_API_KEY_AND_MODEL_NOT_CONFIGURED;
		return;
	}

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
		const existingMsgs: MessageBase[] = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
		const history: MessageBase[] = actPlotInterview ? existingMsgs : [seedMsg(), ...existingMsgs];
		const updateCallback = (state: StreamState) => {
			messages[messageIdx] = { ...messages[messageIdx], content: state.content };
		};
		await streamWorldBuilderChat(history, updateCallback, abortController.signal, providerConfig);

		// Persist messages to DB when in interview mode
		if (actPlotInterview && interviewActLineId) {
			await persistInterviewMessages(userMessage, getCurrentMessage());
		}
	} catch (err: unknown) {
		if (isAbortLikeError(err)) {
			// Persist partial content on abort in interview mode
			if (actPlotInterview && interviewActLineId) {
				const partial = getCurrentMessage();
				if (partial?.content) {
					await persistInterviewMessages(userMessage, partial);
				}
			}
			return;
		}
		error = getUserFacingErrorMessage(err);
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
	onUpdate: (state: StreamState) => void,
	abortSignal: AbortSignal,
	providerConfig: ProviderConfig
): Promise<StreamAccumulator> {
	const fullSystemPrompt =
		actPlotInterview && cachedInterviewSystemPrompt ? cachedInterviewSystemPrompt : await buildFullWorldBuildPrompt();
	const llmHistory = actPlotInterview ? [...interviewHiddenContext, ...history] : history;

	const requirementTools = buildRequirementTools(handleRecordRequirement);
	const tools: ToolSet =
		!actPlotInterview && wbPhase === 'pre-template'
			? { ...buildWorldBuilderTools(handleTemplateSelected), ...requirementTools }
			: requirementTools;

	const [, accumulator] = await Promise.all([
		logWorldBuilderChat({
			systemPrompt: fullSystemPrompt,
			messages: llmHistory,
			logFilename: logFilePath ?? undefined,
		}),
		streamChatResponse(fullSystemPrompt, llmHistory, abortSignal, onUpdate, () => {}, providerConfig, tools),
	]);
	// executeStream never throws — errors reject resultMetadata. Await it so
	// connection failures propagate to the caller instead of leaving an empty message.
	await accumulator.resultMetadata;
	return accumulator;
}
