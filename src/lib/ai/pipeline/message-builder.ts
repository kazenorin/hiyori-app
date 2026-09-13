import type { MessageBase } from '$lib/db/messages';
import type { ActPhase, GameDataFields, NarrativeOverrides, NarrativeVariables } from '../narrative-types';
import { hasNarrativeOverrides } from '../narrative-types';
import type { CommonPipelineInput, PlayerContext, PostEditorContext, PreEditorContext } from './types';
import type { ActPhaseBoundary } from '$lib/db/act-lines';
import type { StreamState } from '../chat-callbacks';
import {
	formatActPhaseBoundariesSection,
	formatDirectorNotesSection,
	formatPreviousNarrativeBody,
	formatStorySoFar,
	formatTurnOfEventsSection,
	SECTION,
} from '$lib/definitions/pipeline-sections';
import {
	actSummaryForScenesHeader,
	actSummaryHeader,
	mainContextHeader,
	sectionFormat,
	summariesHeader,
	summaryHeader,
} from '$lib/definitions/common-headers';
import { aliasesLabel, locationLabel, sceneWithNumberLabel } from '$lib/definitions/common-labels';
import { hasTemplateMetadata, variablesToMarkdown } from '../template-renderer';
import { type ActSummary, parseActSummary, pruneCharacterScenes, serializeActSummary } from '../act-summary-parser';
import { upToLabel } from '$lib/definitions/character-profile-labels';
import {
	characterSummariesHeader,
	sceneSummariesHeader,
	summarizerFullExtractionPromptTemplate,
	summarizerTranscriptEnd,
	summarizerTranscriptStart,
} from '$lib/definitions/pipeline-prompts';

// --- Utility functions ---

/**
 * Reconstruct full output text from a StreamState.
 * The narrative stream parser routes structured sections (Scene Title, Background,
 * Narrative Body, CG) into `variables` and accumulates all text in `content`.
 * For phases that output the writer template format, we combine both.
 */
export function fullOutput(ss: StreamState): string {
	if (ss.variables && (ss.variables.sceneTitle || ss.variables.narrativeBody)) {
		return variablesToMarkdown(ss.variables);
	}
	return ss.content;
}

/** True if a string value is present (non-null and non-blank). */
export function hasContent(value: string | null | undefined): value is string {
	return value != null && value.trim().length > 0;
}

/** Merge fitter variables with original, preferring original non-blank values. */
export function mergeVariables(original: NarrativeVariables | null, fitter: NarrativeVariables | null): NarrativeVariables | null {
	if (!fitter) return original;
	if (!original) return fitter;
	return {
		sceneTitle: hasContent(original.sceneTitle) ? original.sceneTitle : fitter.sceneTitle,
		background: hasContent(original.background) ? original.background : fitter.background,
		narrativeBody: hasContent(original.narrativeBody) ? original.narrativeBody : fitter.narrativeBody,
		turnOfEvents: hasContent(original.turnOfEvents) ? original.turnOfEvents : fitter.turnOfEvents,
		cg: hasContent(original.cg) ? original.cg : fitter.cg,
		gameData: original.gameData ?? fitter.gameData,
	};
}

/** Merge fitter game data with original, preferring original non-empty values. */
export function mergeGameData(original: GameDataFields | null, fitter: GameDataFields | null): GameDataFields | null {
	if (!fitter) return original;
	if (!original) return fitter;
	return {
		activePlotThreads: original.activePlotThreads.length > 0 ? original.activePlotThreads : fitter.activePlotThreads,
		decisionContext: hasContent(original.decisionContext) ? original.decisionContext : fitter.decisionContext,
		decisions: original.decisions.length > 0 ? original.decisions : fitter.decisions,
	};
}

/** Check whether editor variables have template metadata. */
export function editorHasTemplateMetadata(variables: NarrativeVariables | null | undefined): boolean {
	return hasTemplateMetadata(variables);
}

/**
 * Apply writer-tool overrides onto parsed narrative variables, fill-when-missing.
 * Returns the original variables unchanged when no override is set; otherwise
 * merges overrides as the "fitter" via mergeVariables (original non-blank values win).
 */
export function applyNarrativeOverrides(variables: NarrativeVariables | null, overrides: NarrativeOverrides): NarrativeVariables | null {
	if (!hasNarrativeOverrides(overrides)) return variables;
	const fitter: NarrativeVariables = { ...overrides, gameData: null };
	return mergeVariables(variables, fitter);
}

/**
 * Convert an array of content strings into user messages.
 */
export function toUserMessages(contents: string[]): MessageBase[] {
	return contents.map((content) => ({ role: 'user' as const, content }));
}

// --- Act summary template ---

/**
 * Apply label substitutions to an act-summary template LS-string.
 * Handles: {{actSummaryHeader}} {{sceneSummariesHeader}} {{characterSummariesHeader}}
 *          {{sceneWithNumber}} {{locationLabel}} {{summaryHeader}} {{aliasesLabel}}
 *          {{sceneNumber}} {{sceneTitle}}
 *
 * `{{sceneWithNumber}}` is expanded via `sceneWithNumberLabel('{{sceneNumber}}')` so that the
 * subsequent `{{sceneNumber}}` pass fills the scene number into the localized label.
 */
export function substituteActSummaryTemplate(
	template: string,
	{ sceneNumber, sceneTitle }: { sceneNumber: string; sceneTitle: string }
): string {
	return template
		.replaceAll('{{actSummaryHeader}}', actSummaryHeader())
		.replaceAll('{{sceneSummariesHeader}}', sceneSummariesHeader())
		.replaceAll('{{characterSummariesHeader}}', characterSummariesHeader())
		.replaceAll('{{sceneWithNumber}}', sceneWithNumberLabel(sceneNumber))
		.replaceAll('{{locationLabel}}', locationLabel())
		.replaceAll('{{summaryHeader}}', summaryHeader())
		.replaceAll('{{aliasesLabel}}', aliasesLabel())
		.replaceAll('{{sceneTitle}}', sceneTitle);
}

// --- Shared section builders ---

function playerResponseSection(playerContext: PlayerContext | undefined): string[] {
	const playerResponse = playerContext?.playerResponse;
	return playerResponse ? [SECTION.PLAYER_RESPONSE + playerResponse] : [];
}

export function formattedActSummary(actSummary: string): string[] {
	if (actSummary.trim().length == 0) return [];
	const existingParsed = parseActSummary(actSummary);
	const serializedActSummary = serializeActSummary(pruneCharacterScenes(existingParsed));
	return [SECTION.ACT_SUMMARY + serializedActSummary];
}

/**
 * Format act summary for compressor input — uses the NEW act summary (post-Summarizer).
 */
export function formatActSummaryForCompressor(completedScenes: number, newActSummary: ActSummary): string[] {
	const actSummaryHeading = sectionFormat(`(${upToLabel()} ${sceneWithNumberLabel(completedScenes)})`);
	const summarizerActSummary = serializeActSummary({ ...newActSummary, characterProfiles: [], characterProfileLastScene: null });
	return summarizerActSummary ? [actSummaryHeading + summarizerActSummary] : [];
}

/**
 * Format act summary for summarizer input — uses the EXISTING act summary.
 */
export function formatActSummaryForSummarizer(completedScenes: number, actSummary: ActSummary): string[] {
	const actSummaryHeading = sectionFormat(
		actSummaryForScenesHeader(completedScenes <= 1 ? '' : `(${upToLabel()} ${sceneWithNumberLabel(completedScenes - 1)})`)
	);
	const summarizerActSummary = serializeActSummary({ ...actSummary, characterProfiles: [], characterProfileLastScene: null });
	return summarizerActSummary ? [actSummaryHeading + summarizerActSummary] : [];
}

// --- Stage-2 shared-prefix message builders (Tiers 0–1) ---

/** Assemble the Tier-0 Main Context message: World Content · Story so Far · Act Plot. */
export function buildMainContextMessage(input: {
	worldContent: string;
	actPlot: string;
	previousActSummaries: { actNumber: number; summary: string }[];
	actNumber: number;
}): string {
	const parts: string[] = [
		sectionFormat(mainContextHeader(), 1),
		SECTION.WORLD_CONTENT + input.worldContent,
		...formatStorySoFar(input.previousActSummaries, input.actNumber),
		SECTION.ACT_PLOT + input.actPlot,
	];
	return parts.join('\n').trimEnd();
}

/**
 * Assemble the Tier-1 Summaries message (Profiles@SP · Act Summary@SP), or `undefined`
 * when there is no summarization point yet / neither snapshot has content — callers
 * then omit the message entirely and start Scenes from the act's first scene.
 */
export function buildSummariesMessage(input: {
	summarizationPoint: number;
	characterProfiles: string[];
	actSummary: string;
}): string | undefined {
	if (input.summarizationPoint <= 0) return undefined;
	const summary = formattedActSummary(input.actSummary);
	if (input.characterProfiles.length === 0 && summary.length === 0) return undefined;
	return [sectionFormat(summariesHeader(), 1), ...input.characterProfiles, ...summary].join('\n').trimEnd();
}

// --- Context interfaces ---

/** Build the shared sections used by Writer, Reviewer, and Editor. */
function buildPreEditorSections(ctx: PreEditorContext): string[] {
	return [
		SECTION.WORLD_CONTENT + ctx.worldContent,
		SECTION.ACT_PLOT + ctx.actPlot,
		...ctx.characterProfiles,
		...formatStorySoFar(ctx.previousActSummaries, ctx.actNumber),
		...formattedActSummary(ctx.actSummary),
		...formatActPhaseBoundariesSection(ctx.actPhaseBoundaries),
		...(ctx.previousScenePlot ? [SECTION.SCENE_PLOT + ctx.previousScenePlot] : []),
		...formatPreviousNarrativeBody(ctx.previousNarrativeBody, ctx.completedScenes),
		...playerResponseSection(ctx.player),
		...formatTurnOfEventsSection(ctx.previousTurnOfEvents),
		...formatDirectorNotesSection(ctx.directorNotes),
	];
}

/** Build the shared sections used by Game Master and Plot Planner. */
function buildPostEditorSections(ctx: PostEditorContext): string[] {
	return [
		SECTION.ACT_PLOT + ctx.actPlot,
		...ctx.characterProfiles,
		...formatStorySoFar(ctx.previousActSummaries, ctx.actNumber),
		...formattedActSummary(ctx.actSummary),
		...formatActPhaseBoundariesSection(ctx.actPhaseBoundaries),
		...(ctx.previousScenePlot ? [SECTION.SCENE_PLOT + ctx.previousScenePlot] : []),
		...formatPreviousNarrativeBody(ctx.previousNarrativeBody, ctx.completedScenes),
		...playerResponseSection(ctx.player),
		...formatTurnOfEventsSection(ctx.previousTurnOfEvents),
		...(ctx.editorOutput ? [SECTION.EDITOR_OUTPUT + ctx.editorOutput] : []),
		...formatDirectorNotesSection(ctx.directorNotes),
	];
}

// --- Per-phase message builders ---

export function buildWriterMessages(ctx: PreEditorContext, extractionPrompt: string): MessageBase[] {
	return toUserMessages([...buildPreEditorSections(ctx), extractionPrompt]);
}

export function buildReviewerMessages(ctx: PreEditorContext, writerOutput: string | undefined, extractionPrompt: string): MessageBase[] {
	return toUserMessages([
		...buildPreEditorSections(ctx),
		...(writerOutput ? [SECTION.WRITER_OUTPUT + writerOutput] : []),
		extractionPrompt,
	]);
}

export function buildEditorMessages(
	ctx: PreEditorContext,
	writerOutput: string | undefined,
	reviewerOutput: string | undefined,
	extractionPrompt: string
): MessageBase[] {
	return toUserMessages([
		...buildPreEditorSections(ctx),
		...(writerOutput ? [SECTION.WRITER_OUTPUT + writerOutput] : []),
		...(reviewerOutput ? [SECTION.REVIEWER_OUTPUT + reviewerOutput] : []),
		extractionPrompt,
	]);
}

export function buildEditorFitterMessages(editorOutput: string, writerOutputTemplate: string, extractionPrompt: string): MessageBase[] {
	return toUserMessages([SECTION.EDITOR_OUTPUT + editorOutput, SECTION.WRITER_OUTPUT_TEMPLATE + writerOutputTemplate, extractionPrompt]);
}

export function buildGamePhaseMessages(ctx: PostEditorContext, extractionPrompt: string): MessageBase[] {
	return toUserMessages([...buildPostEditorSections(ctx), extractionPrompt]);
}

export function buildGmFitterMessages(editorOutput: string, gmOutput: string, extractionPrompt: string): MessageBase[] {
	return toUserMessages([SECTION.EDITOR_OUTPUT + editorOutput, SECTION.GAME_MASTER_OUTPUT + gmOutput, extractionPrompt]);
}

// --- Summarizer message builder ---

export function buildSummarizerMessages(
	actSummary: string,
	previousNarrativeVariables: NarrativeVariables | undefined,
	completedScenes: number,
	player: PlayerContext | undefined,
	parsedActSummary: ActSummary | undefined,
	extractionPromptTemplate: (completedScenes: number, sceneTitle: string) => string,
	fallbackExtractionPromptTemplate: (completedScenes: number) => string
): MessageBase[] {
	const sceneTitle = previousNarrativeVariables?.sceneTitle ?? '';

	const effectiveSummary = parsedActSummary ?? parseActSummary(actSummary);
	if (previousNarrativeVariables && previousNarrativeVariables.narrativeBody) {
		return toUserMessages([
			...formatActSummaryForSummarizer(completedScenes, effectiveSummary),
			...formatPreviousNarrativeBody(previousNarrativeVariables.narrativeBody, completedScenes),
			...playerResponseSection(player),
			...formatTurnOfEventsSection(previousNarrativeVariables.turnOfEvents),
			extractionPromptTemplate(completedScenes, sceneTitle),
		]);
	} else {
		return toUserMessages([
			...formatActSummaryForSummarizer(completedScenes, effectiveSummary),
			...playerResponseSection(player),
			fallbackExtractionPromptTemplate(completedScenes),
		]);
	}
}

export function buildTranscriptSummarizerMessages(transcript: { role: 'user' | 'assistant'; content: string }[]): MessageBase[] {
	return [
		{ role: 'user', content: summarizerTranscriptStart() },
		...transcript,
		{ role: 'user', content: summarizerTranscriptEnd() },
		{ role: 'user', content: summarizerFullExtractionPromptTemplate() },
	];
}

export abstract class AbstractPreEditorContext implements PreEditorContext {
	actPhase: ActPhase | null;
	actPhaseBoundaries: ActPhaseBoundary[];
	actPlot: string;
	actSummary: string;
	actNumber: number;
	characterProfiles: string[];
	completedScenes: number;
	directorNotes: string;
	previousActSummaries: { actNumber: number; summary: string }[];
	previousNarrativeBody: string | undefined;
	previousTurnOfEvents: string | undefined;
	worldContent: string;

	abstract previousScenePlot: string | undefined;
	abstract player: PlayerContext | undefined;

	protected constructor({
		worldContent,
		actPlot,
		actSummary,
		characterProfiles,
		completedScenes,
		directorNotes,
		previousActSummaries,
		story,
		previousNarrativeVariables,
	}: CommonPipelineInput) {
		this.worldContent = worldContent;
		this.actPlot = actPlot;
		this.actPhase = story.actLine.currentActPhase;
		this.actPhaseBoundaries = story.actLine.actPhaseBoundaries;
		this.actSummary = actSummary;
		this.actNumber = story.actLine.actNumber;
		this.characterProfiles = characterProfiles;
		this.completedScenes = completedScenes;
		this.directorNotes = directorNotes;
		this.previousActSummaries = previousActSummaries;
		this.previousNarrativeBody = previousNarrativeVariables?.narrativeBody ?? undefined;
		this.previousTurnOfEvents = previousNarrativeVariables?.turnOfEvents ?? undefined;
	}
}
