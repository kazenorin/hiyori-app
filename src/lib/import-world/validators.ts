// Validation logic for Import World feature

import type { ImportFormData, ImportActInput, ValidationResult, ValidationError, ValidationWarning } from './types';
import { MAX_FILE_SIZE } from '$lib/utils/async';

export function validateImportForm(formData: ImportFormData): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	// Warn if story name is empty
	if (!formData.storyName.trim()) {
		warnings.push({
			field: 'storyName',
			message: 'Story name is empty — a placeholder name will be auto-generated.'
		});
	}

	// Validate acts
	const hasWorldFile = formData.worldFile !== null;
	const hasMultipleActs = formData.acts.length > 1;

	// If no world file OR more than one act, every act must have file or transcript
	if (!hasWorldFile || hasMultipleActs) {
		for (const act of formData.acts) {
			if (!act.actFile && !act.transcript) {
				errors.push({
					field: `act-${act.id}`,
					message: hasMultipleActs
						? 'Each act must have either an act/chapter file or a transcript when there are multiple acts.'
						: 'Each act must have either an act/chapter file or a transcript when no world building file is provided.'
				});
			}
		}
	}

	// Warn about missing act names
	for (const act of formData.acts) {
		if (!act.name.trim()) {
			warnings.push({
				field: `act-${act.id}-name`,
				message: `Act ${formData.acts.indexOf(act) + 1} name is empty — a placeholder name will be auto-generated.`
			});
		}
	}

	// Warn about missing character cards (don't error - let user proceed with warning)
	for (const character of formData.characters) {
		if (!character.cardFile) {
			warnings.push({
				field: `character-${character.id}`,
				message: 'Character card file is missing — character will be skipped during import.'
			});
		}
	}

	// Warn about missing character names
	for (const character of formData.characters) {
		if (character.cardFile && !character.name.trim()) {
			warnings.push({
				field: `character-${character.id}-name`,
				message: 'Character name is empty — a name will be derived from the card content.'
			});
		}
	}

	// Validate file sizes (50MB max)
	if (formData.worldFile && formData.worldFile.size > MAX_FILE_SIZE) {
		errors.push({
			field: 'worldFile',
			message: `World file too large (${(formData.worldFile.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`
		});
	}
	for (const act of formData.acts) {
		if (act.actFile && act.actFile.size > MAX_FILE_SIZE) {
			errors.push({
				field: `act-${act.id}-file`,
				message: `Act file too large (${(act.actFile.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`
			});
		}
		if (act.transcript && act.transcript.size > MAX_FILE_SIZE) {
			errors.push({
				field: `act-${act.id}-transcript`,
				message: `Transcript file too large (${(act.transcript.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`
			});
		}
	}
	for (const character of formData.characters) {
		if (character.cardFile && character.cardFile.size > MAX_FILE_SIZE) {
			errors.push({
				field: `character-${character.id}-file`,
				message: `Character card too large (${(character.cardFile.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`
			});
		}
	}

	// At least one piece of content must be provided
	if (!hasWorldFile && formData.acts.length === 0 && formData.characters.length === 0) {
		errors.push({
			field: 'form',
			message: 'At least a world building file, an act, or a character must be provided.'
		});
	}

	// Validate retry settings
	if (formData.retryCount < 0 || formData.retryCount > 20) {
		errors.push({
			field: 'retryCount',
			message: 'LLM Retry Count must be between 0 and 20.'
		});
	}
	if (formData.backoffIntervalSeconds < 1 || formData.backoffIntervalSeconds > 60) {
		errors.push({
			field: 'backoffIntervalSeconds',
			message: 'Backoff Interval must be between 1 and 60 seconds.'
		});
	}

	// Validate file types for acts
	for (const act of formData.acts) {
		if (act.actFile && !isValidTextFile(act.actFile)) {
			errors.push({
				field: `act-${act.id}-file`,
				message: 'Act/chapter file must be a .md or .txt file.'
			});
		}
		if (act.transcript && !isValidJsonFile(act.transcript)) {
			errors.push({
				field: `act-${act.id}-transcript`,
				message: 'Transcript file must be a .json file.'
			});
		}
	}

	// Validate character card file types
	for (const character of formData.characters) {
		if (character.cardFile && !isValidTextFile(character.cardFile)) {
			errors.push({
				field: `character-${character.id}-file`,
				message: 'Character card file must be a .md or .txt file.'
			});
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
		warnings
	};
}

export function hasRequiredActContent(act: ImportActInput, hasWorldFile: boolean, hasMultipleActs: boolean): boolean {
	if (hasWorldFile && !hasMultipleActs) {
		return true;
	}
	return act.actFile !== null || act.transcript !== null;
}

function isValidTextFile(file: File): boolean {
	const name = file.name.toLowerCase();
	return name.endsWith('.md') || name.endsWith('.txt');
}

function isValidJsonFile(file: File): boolean {
	return file.name.toLowerCase().endsWith('.json');
}
