// UI state management for Import World page

import type {
	ImportFormData,
	ImportActInput,
	ImportCharacterInput,
	ImportProgressUpdate,
	ValidationResult,
	ImportPhase,
} from '$lib/import-world/types';
import { validateImportForm } from '$lib/import-world/validators';

// === Form State ===

let storyName = $state('');
let worldFile = $state<File | null>(null);
let acts = $state<ImportActInput[]>([]);
let characters = $state<ImportCharacterInput[]>([]);
let skipOptionalMalformed = $state(false);
let retryCount = $state(5);
let backoffIntervalSeconds = $state(5);

// === UI State ===

let isImporting = $state(false);
let importComplete = $state(false);
let validationResult = $state<ValidationResult | null>(null);
let progressUpdates = $state<ImportProgressUpdate[]>([]);
let currentPhase = $state<ImportPhase>('validating');
let consoleOutput = $state('');
const MAX_CONSOLE_LINES = 50;
let importError = $state<string | null>(null);
let showValidationWarnings = $state(false);

// === Derived ===

let canSubmit = $derived(!isImporting && !importComplete);

// === Form Actions ===

function addAct(): void {
	acts = [
		...acts,
		{
			id: crypto.randomUUID(),
			name: '',
			actFile: null,
			transcript: null,
		},
	];
}

function removeAct(id: string): void {
	acts = acts.filter((a) => a.id !== id);
}

function addCharacter(): void {
	characters = [
		...characters,
		{
			id: crypto.randomUUID(),
			name: '',
			cardFile: null,
		},
	];
}

function removeCharacter(id: string): void {
	characters = characters.filter((c) => c.id !== id);
}

function updateActFile(id: string, file: File | null): void {
	acts = acts.map((a) => (a.id === id ? { ...a, actFile: file } : a));
}

function updateActTranscript(id: string, file: File | null): void {
	acts = acts.map((a) => (a.id === id ? { ...a, transcript: file } : a));
}

function updateActName(id: string, name: string): void {
	acts = acts.map((a) => (a.id === id ? { ...a, name } : a));
}

function updateCharacterName(id: string, name: string): void {
	characters = characters.map((c) => (c.id === id ? { ...c, name } : c));
}

function updateCharacterFile(id: string, file: File | null): void {
	characters = characters.map((c) => (c.id === id ? { ...c, cardFile: file } : c));
}

function validate(): ValidationResult {
	const formData = getFormData();
	const result = validateImportForm(formData);
	validationResult = result;
	showValidationWarnings = result.warnings.length > 0;
	return result;
}

function getFormData(): ImportFormData {
	return {
		storyName,
		worldFile,
		acts: [...acts],
		characters: [...characters],
		skipOptionalMalformed,
		retryCount,
		backoffIntervalSeconds,
	};
}

function addProgressUpdate(update: ImportProgressUpdate): void {
	currentPhase = update.phase;
	if (progressUpdates.length > 0) {
		const previousUpdate = progressUpdates[progressUpdates.length - 1];
		if (previousUpdate.phase == currentPhase && previousUpdate.message == update.message) {
			const repeatedProgress = progressUpdates.slice(0, -1);
			repeatedProgress.push({ ...update, repeatedMessageCounter: (previousUpdate.repeatedMessageCounter ?? 0) + 1 });
			progressUpdates = repeatedProgress;
		} else {
			progressUpdates = [...progressUpdates, update];
		}
	} else {
		progressUpdates = [update];
	}

	if (update.consoleOutput) {
		const buffer = consoleOutput + update.consoleOutput;
		const lines = buffer.split('\n');
		consoleOutput = lines.length > MAX_CONSOLE_LINES ? lines.slice(-MAX_CONSOLE_LINES).join('\n') : buffer;
	}
	if (update.phase === 'error' && update.errorMessage) {
		importError = update.errorMessage;
	}
}

function resetForm(): void {
	storyName = '';
	worldFile = null;
	acts = [];
	characters = [];
	skipOptionalMalformed = false;
	retryCount = 5;
	backoffIntervalSeconds = 5;
	isImporting = false;
	importComplete = false;
	validationResult = null;
	progressUpdates = [];
	currentPhase = 'validating';
	consoleOutput = '';
	importError = null;
	showValidationWarnings = false;
}

function setImporting(value: boolean): void {
	isImporting = value;
	if (value) {
		progressUpdates = [];
		importError = null;
		importComplete = false;
	}
}

function setImportComplete(): void {
	importComplete = true;
	isImporting = false;
}

// === Exports ===

export function getImportWorldStore() {
	return {
		// State getters
		get storyName() {
			return storyName;
		},
		get worldFile() {
			return worldFile;
		},
		get acts() {
			return acts;
		},
		get characters() {
			return characters;
		},
		get skipOptionalMalformed() {
			return skipOptionalMalformed;
		},
		get retryCount() {
			return retryCount;
		},
		get backoffIntervalSeconds() {
			return backoffIntervalSeconds;
		},
		get isImporting() {
			return isImporting;
		},
		get importComplete() {
			return importComplete;
		},
		get validationResult() {
			return validationResult;
		},
		get progressUpdates() {
			return progressUpdates;
		},
		get currentPhase() {
			return currentPhase;
		},
		get consoleOutput() {
			return consoleOutput;
		},
		get importError() {
			return importError;
		},
		get showValidationWarnings() {
			return showValidationWarnings;
		},
		get canSubmit() {
			return canSubmit;
		},

		// Setters
		set importComplete(v: boolean) {
			importComplete = v;
		},
		set storyName(v: string) {
			storyName = v;
		},
		set worldFile(v: File | null) {
			worldFile = v;
		},
		set skipOptionalMalformed(v: boolean) {
			skipOptionalMalformed = v;
		},
		set retryCount(v: number) {
			retryCount = v;
		},
		set backoffIntervalSeconds(v: number) {
			backoffIntervalSeconds = v;
		},

		// Actions
		addAct,
		removeAct,
		addCharacter,
		removeCharacter,
		updateActFile,
		updateActTranscript,
		updateActName,
		updateCharacterName,
		updateCharacterFile,
		validate,
		getFormData,
		addProgressUpdate,
		resetForm,
		setImporting,
		setImportComplete,
	};
}
