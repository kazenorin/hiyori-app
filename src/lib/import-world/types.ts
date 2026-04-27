// Core types for Import World feature

import type { GameDataFields } from '$lib/ai/parser-chain';

// === Transcript Format Detection ===

export type TranscriptFormat = 'app-export' | 'openai-api' | 'openwebui' | 'unknown';

// === Import Form Data ===

export interface ImportFormData {
	storyName: string;
	worldFile: File | null;
	acts: ImportActInput[];
	characters: ImportCharacterInput[];
	skipOptionalMalformed: boolean;
	retryCount: number;
	backoffIntervalSeconds: number;
}

export interface ImportActInput {
	id: string; // Unique ID for UI tracking
	name: string;
	actFile: File | null;
	transcript: File | null;
}

export interface ImportCharacterInput {
	id: string; // Unique ID for UI tracking
	name: string;
	cardFile: File | null;
}

// === Parsed Transcript Types ===

export interface ParsedTranscript {
	format: TranscriptFormat;
	messages: ParsedMessage[];
}

export interface ParsedMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	reasoning?: string;
	metadata?: string;
	gameData?: GameDataFields;
}

// === Open WebUI Specific Types ===

export interface OpenWebUIExport {
	title: string;
	chat: {
		history: {
			messages: Record<string, OpenWebUIMessage>;
		};
	};
}

export interface OpenWebUIMessage {
	id: string;
	parentId: string | null;
	childrenIds: string[] | null;
	role: 'user' | 'assistant' | 'system';
	content: string;
	usage?: Record<string, unknown>;
	output?: OpenWebUIOutput[];
}

export interface OpenWebUIOutput {
	type: string; // e.g., "reasoning" | "message"
	content: OpenWebUIOutputContent[] | null;
}

export interface OpenWebUIOutputContent {
	type: string; // e.g., "output_text"
	text?: string;
}

// === Import Result Types ===

export interface ImportResult {
	success: boolean;
	storyId?: string;
	actId?: string;
	actLineId?: string;
	error?: string;
	warnings: string[];
	importComplete?: boolean;
}

export interface ImportProgressUpdate {
	phase: ImportPhase;
	message: string;
	repeatedMessageCounter?: number;
	errorMessage?: string;
	consoleOutput?: string;
}

export type ImportPhase =
	| 'validating'
	| 'creating-story'
	| 'processing-act'
	| 'generating-act'
	| 'formatting-act'
	| 'generating-game-data'
	| 'saving-messages'
	| 'finalizing'
	| 'complete'
	| 'error';

// === Validation Types ===

export interface ValidationResult {
	isValid: boolean;
	errors: ValidationError[];
	warnings: ValidationWarning[];
}

export interface ValidationError {
	field: string;
	message: string;
}

export interface ValidationWarning {
	field: string;
	message: string;
}

// === Game Data Detection Types ===

export interface GameDataExtractionResult {
	messageIndex: number;
	gameData: GameDataFields | null;
	source: 'traditional' | 'llm' | 'none';
	metadata?: string;
}

export interface GameDataDetectionResult {
	results: GameDataExtractionResult[];
	llmCallsMade: number;
}

// === Import Story Structure ===

export interface ImportStoryData {
	id: string;
	name: string;
	worldContent: string | null;
	acts: ImportActData[];
	characters: ImportCharacterData[];
}

export interface ImportActData {
	id: string;
	name: string;
	actNumber: number;
	continuesFromActLineId: string | null;
	cardContent: string | null;
	messages: ParsedMessage[];
	generatedContent: string | null;
}

export interface ImportCharacterData {
	id: string;
	name: string;
	cardContent: string;
}
