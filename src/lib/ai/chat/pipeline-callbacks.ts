import { log } from '$lib/logging/logger';
import { isReviewerEnabled } from '$lib/stores/settings.svelte';
import { getErrorMessage } from '$lib/utils/error-handling';
import type { UIMessage } from './types';
import type { GameDataFields, NarrativeVariables, PhaseName, UIScenePhase } from '../narrative-types';
import type { PipelineCallbacks, PipelineState, PhaseStreamState } from '../pipeline/types';
import { serializeImportantPhrases, updatePersistentMessageMetadata } from './persistence';

/** Merge Editor variables with GM game data into final NarrativeVariables */
export function buildFinalVariables(
	editorVariables: NarrativeVariables | null | undefined,
	gameData: GameDataFields | null | undefined
): NarrativeVariables | undefined {
	if (!editorVariables && !gameData) return undefined;
	return {
		sceneTitle: editorVariables?.sceneTitle ?? null,
		background: editorVariables?.background ?? null,
		narrativeBody: editorVariables?.narrativeBody ?? null,
		turnOfEvents: editorVariables?.turnOfEvents ?? null,
		cg: editorVariables?.cg ?? null,
		gameData: gameData ?? editorVariables?.gameData ?? null,
	};
}

/** Get the display content for a completed phase */
export function getPhaseContent(phase: PhaseName, state: PipelineState): string {
	switch (phase) {
		case 'PLOT_PLANNER':
			return state.scenePlot ?? '';
		case 'WRITER':
			return state.writerOutput ?? '';
		case 'REVIEWER':
			return state.reviewerOutput ?? '';
		case 'EDITOR':
			return state.editorOutput ?? '';
		case 'GAME_MASTER':
			return state.gameMasterOutput ?? '';
		case 'SUMMARIZER':
			return state.actSummary ?? '';
		case 'TEMPLATE_FITTER':
			return '';
		case 'CHARACTER_PROFILE_COMPRESSOR':
			return '';
	}
}

export interface CallbackDeps {
	getCurrentMessage: () => UIMessage;
	setCurrentMessage: (msg: UIMessage) => void;
	onError: (errorMessage: string) => void;
}

export function createOptionalCallbacks({
	onPhaseStart = () => {},
	onPhaseStream = () => {},
	onPhaseRetry = () => {},
	onPhaseComplete = () => {},
	onError = (_phase, _err) => {},
	onAllComplete = () => {},
}: Partial<PipelineCallbacks> = {}): PipelineCallbacks {
	return {
		onPhaseStart,
		onPhaseStream,
		onPhaseRetry,
		onPhaseComplete,
		onError,
		onAllComplete,
	};
}

export function createPipelineCallbacks(deps: CallbackDeps): PipelineCallbacks {
	const { getCurrentMessage, setCurrentMessage, onError } = deps;

	const phasesOfMainChat: PhaseName[] = isReviewerEnabled() ? ['EDITOR'] : ['EDITOR', 'WRITER'];

	const updatePhaseInList = (phase: PhaseName, update: Partial<UIScenePhase>): void => {
		const current = getCurrentMessage();
		const phases = (current.phases ?? []).map((p) => (p.phaseName === phase ? { ...p, ...update } : p));
		setCurrentMessage({ ...current, phases });
	};

	const updateEditorMessage = (
		content: string,
		reasoning: string | null | undefined,
		variables: NarrativeVariables | null | undefined
	): void => {
		const current = getCurrentMessage();
		setCurrentMessage({
			...current,
			content,
			reasoning: reasoning ?? current.reasoning,
			variables: variables ?? current.variables,
		});
	};

	return {
		onPhaseStart: (phase: PhaseName) => {
			if (phasesOfMainChat.includes(phase)) return;
			const current = getCurrentMessage();
			const phases = [...(current.phases ?? []), { phaseName: phase, content: '' }];
			setCurrentMessage({ ...current, phases });
		},
		onPhaseStream: (phase: PhaseName, streamState: PhaseStreamState) => {
			if (phasesOfMainChat.includes(phase)) {
				updateEditorMessage(streamState.content, streamState.reasoning, streamState.variables);
				return;
			}
			updatePhaseInList(phase, { content: streamState.content, reasoning: streamState.reasoning ?? undefined });
		},
		onPhaseRetry: (phase: PhaseName, attempt: number, maxAttempts: number) => {
			updatePhaseInList(phase, { content: `Retrying (attempt ${attempt}/${maxAttempts})...` });
		},
		onPhaseComplete: (phase: PhaseName, pipelineState: PipelineState) => {
			if (phasesOfMainChat.includes(phase)) {
				updateEditorMessage(
					pipelineState.editorOutput ?? getCurrentMessage().content,
					pipelineState.editorReasoning,
					pipelineState.editorVariables
				);
				return;
			}
			if (phase === 'TEMPLATE_FITTER') {
				if (pipelineState.editorVariables) {
					updateEditorMessage(
						pipelineState.editorOutput ?? getCurrentMessage().content,
						pipelineState.editorReasoning,
						pipelineState.editorVariables
					);
				} else if (pipelineState.gameData) {
					const current = getCurrentMessage();
					const finalVars = buildFinalVariables(current.variables, pipelineState.gameData);
					setCurrentMessage({ ...current, variables: finalVars ?? current.variables });
				}
				return;
			}

			updatePhaseInList(phase, { content: getPhaseContent(phase, pipelineState) });

			if (phase === 'GAME_MASTER') {
				const current = getCurrentMessage();
				const finalVars = buildFinalVariables(current.variables, pipelineState.gameData);
				setCurrentMessage({ ...current, variables: finalVars ?? current.variables });
			}

			if (phase === 'PLOT_PLANNER' && pipelineState.scenePlot) {
				const current = getCurrentMessage();
				setCurrentMessage({ ...current, scenePlot: pipelineState.scenePlot });
			}
		},
		onError: (phase: PhaseName, err: unknown) => {
			const errorMessage = getErrorMessage(err);
			log.error('pipeline', `Phase ${phase} failed: ${errorMessage}`, err);
			onError(errorMessage);
		},
		onAllComplete: (pipelineState: PipelineState) => {
			const current = getCurrentMessage();
			const finalVars = buildFinalVariables(current.variables ?? pipelineState.editorVariables, pipelineState.gameData);
			setCurrentMessage({
				...current,
				content: pipelineState.editorOutput ?? current.content,
				variables: finalVars ?? current.variables,
			});
		},
		onPhrasesExtracted: (phrases: string[]) => {
			const current = getCurrentMessage();
			updatePersistentMessageMetadata(current.id, { importantPhrases: serializeImportantPhrases(phrases) }).catch(async (err) => {
				await log.error('phrase-persist', 'Failed to persist important phrases', err);
			});
			setCurrentMessage({ ...current, importantPhrases: phrases });
		},
	};
}
