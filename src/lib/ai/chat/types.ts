import type { MessageMetadata } from '../chat-stream';
import type { NarrativeVariables, UIScenePhase } from '../narrative-types';

export interface UIMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	reasoning?: string;
	metadata?: MessageMetadata;
	sceneNumber: number;
	variables?: NarrativeVariables;
	phases?: UIScenePhase[];
	actSummary?: string;
	scenePlot?: string;
	importantPhrases?: string[];
}
