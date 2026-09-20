import type { MessageBase } from '$lib/db/messages';
import type { GameDataFields, NarrativeOverrides, NarrativeVariables } from '../narrative-types';
import { hasNarrativeOverrides } from '../narrative-types';
import type { PipelineContext, PlayerContext } from './types';
import type { StreamState } from '../chat-callbacks';
import {
	formatDirectorNotesSection,
	formatPreviousNarrativeBody,
	formatStorySoFar,
	formatTurnOfEventsSection,
	SECTION,
} from '$lib/definitions/pipeline-sections';
import {
	actSummaryForScenesHeader,
	actSummaryHeader,
	scenesHeader,
	sectionFormat,
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
	return [serializedActSummary];
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

// --- Shared-prefix message builders (Tiers 0–2) ---

/** Assemble the Tier-0 sectional messages: World Content · Story so Far · Act Plot. */
export function buildMainContextMessages(input: {
	worldContent: string;
	actPlot: string;
	previousActSummaries: { actNumber: number; summary: string }[];
}): string[] {
	const messages: string[] = [];
	if (hasContent(input.worldContent)) messages.push((SECTION.WORLD_CONTENT + input.worldContent).trimEnd());
	messages.push(...formatStorySoFar(input.previousActSummaries).map((m) => m.trimEnd()));
	if (hasContent(input.actPlot)) messages.push((SECTION.ACT_PLOT + input.actPlot).trimEnd());
	return messages;
}

/**
 * Assemble the Tier-1 Summaries message (Act Summary@SP only), or `undefined` when there is no
 * summarization point yet / the snapshot has no content — callers then omit the message entirely
 * and start Scenes from the act's first scene. The message is the serialized Act Summary verbatim
 * (it already leads with its own `# Act Summary` H1). Character Profiles are deliberately NOT
 * included: they are dynamic, so a snapshot pinned at the SP confuses the reader; the latest
 * profiles are emitted as their own section after Scenes (see buildPhaseMessages).
 */
export function buildSummariesMessage(input: { summarizationPoint: number; actSummaryAtSP: string }): string | undefined {
	if (input.summarizationPoint <= 0) return undefined;
	const summary = formattedActSummary(input.actSummaryAtSP);
	if (summary.length === 0) return undefined;
	return summary.join('\n').trimEnd();
}

/**
 * Assemble a phase's messages under the shared cacheable prefix:
 * [World Content?][Story So Far?][Act Plot?][Summaries?][Scenes?][Character Profiles?] (Tiers 0–2, byte-identical across
 * phases) then [prior outputs…][extraction prompt][Director's Notes] (Tier 3 tail, per phase).
 *
 * Character Profiles trail Scenes (rather than sitting inside Summaries) because they are the
 * latest snapshot and change every turn; keeping them last in the shared prefix preserves the
 * cache stability of the Tier-0 sections/Summaries/Scenes across turns while still sharing the whole
 * prefix across this turn's phases.
 */
export function buildPhaseMessages(
	ctx: PipelineContext,
	priorOutputs: string[],
	extractionPrompt: string,
	directorNotes: string
): MessageBase[] {
	const scenesMessage =
		ctx.scenesSections.length > 0 ? (sectionFormat(scenesHeader(), 1) + ctx.scenesSections.join('\n')).trimEnd() : undefined;
	const profilesMessage = ctx.characterProfiles.length > 0 ? ctx.characterProfiles.join('\n').trimEnd() : undefined;
	const shared = [...buildMainContextMessages(ctx), buildSummariesMessage(ctx), scenesMessage, profilesMessage].filter(hasContent);
	const tail = [...priorOutputs.filter(hasContent), extractionPrompt, ...formatDirectorNotesSection(directorNotes)];
	return toUserMessages([...shared, ...tail]);
}

// --- Per-phase message builders ---

export function buildEditorFitterMessages(editorOutput: string, writerOutputTemplate: string, extractionPrompt: string): MessageBase[] {
	return toUserMessages([SECTION.EDITOR_OUTPUT + editorOutput, SECTION.WRITER_OUTPUT_TEMPLATE + writerOutputTemplate, extractionPrompt]);
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
