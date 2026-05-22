// Validation logic for Import World feature

import type { ImportFormData, ImportActInput, ValidationResult, ValidationError, ValidationWarning } from './types';
import { MAX_FILE_SIZE } from '$lib/utils/async';
import { ls } from '$lib/localization';

export function validateImportForm(formData: ImportFormData): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	// Warn if story name is empty
	if (!formData.storyName.trim()) {
		warnings.push({
			field: 'storyName',
			message: ls('features.importWorld.validations.storyNameEmpty'),
		});
	}

	// Validate acts
	const hasWorldFile = formData.worldFile !== null;
	const hasMultipleActs = formData.acts.length > 1;

	// All acts except the last must have a transcript
	for (let i = 0; i < formData.acts.length - 1; i++) {
		const act = formData.acts[i];
		if (!act.transcript) {
			errors.push({
				field: `act-${act.id}`,
				message: hasMultipleActs
					? ls('features.importWorld.validations.actTranscriptRequired', { actNumber: i + 1 })
					: ls('features.importWorld.validations.actTranscriptRequiredSingle'),
			});
		}
	}

	// The last act must have either a transcript or an act file (for the interview path)
	if (formData.acts.length > 0) {
		const lastAct = formData.acts[formData.acts.length - 1];
		if (!lastAct.transcript && !lastAct.actFile && !hasWorldFile && formData.characters.every((c) => !c.cardFile)) {
			errors.push({
				field: `act-${lastAct.id}`,
				message: ls('features.importWorld.validations.lastActRequiresContent'),
			});
		}
	}

	// Warn about missing act names
	for (const act of formData.acts) {
		if (!act.name.trim()) {
			warnings.push({
				field: `act-${act.id}-name`,
				message: ls('features.importWorld.validations.actNameEmpty', { actNumber: formData.acts.indexOf(act) + 1 }),
			});
		}
	}

	// Warn about missing character cards (don't error - let user proceed with warning)
	for (const character of formData.characters) {
		if (!character.cardFile) {
			warnings.push({
				field: `character-${character.id}`,
				message: ls('features.importWorld.validations.characterCardMissing'),
			});
		}
	}

	// Warn about missing character names
	for (const character of formData.characters) {
		if (character.cardFile && !character.name.trim()) {
			warnings.push({
				field: `character-${character.id}-name`,
				message: ls('features.importWorld.validations.characterNameEmpty'),
			});
		}
	}

	// Validate file sizes (50MB max)
	if (formData.worldFile && formData.worldFile.size > MAX_FILE_SIZE) {
		errors.push({
			field: 'worldFile',
			message: ls('features.importWorld.validations.fileTooLarge', {
				field: 'World file',
				size: (formData.worldFile.size / 1024 / 1024).toFixed(1),
				max: MAX_FILE_SIZE / 1024 / 1024,
			}),
		});
	}
	for (const act of formData.acts) {
		if (act.actFile && act.actFile.size > MAX_FILE_SIZE) {
			errors.push({
				field: `act-${act.id}-file`,
				message: ls('features.importWorld.validations.fileTooLarge', {
					field: 'Act file',
					size: (act.actFile.size / 1024 / 1024).toFixed(1),
					max: MAX_FILE_SIZE / 1024 / 1024,
				}),
			});
		}
		if (act.transcript && act.transcript.size > MAX_FILE_SIZE) {
			errors.push({
				field: `act-${act.id}-transcript`,
				message: ls('features.importWorld.validations.fileTooLarge', {
					field: 'Transcript',
					size: (act.transcript.size / 1024 / 1024).toFixed(1),
					max: MAX_FILE_SIZE / 1024 / 1024,
				}),
			});
		}
	}
	for (const character of formData.characters) {
		if (character.cardFile && character.cardFile.size > MAX_FILE_SIZE) {
			errors.push({
				field: `character-${character.id}-file`,
				message: ls('features.importWorld.validations.fileTooLarge', {
					field: 'Character card',
					size: (character.cardFile.size / 1024 / 1024).toFixed(1),
					max: MAX_FILE_SIZE / 1024 / 1024,
				}),
			});
		}
	}

	// At least one piece of content must be provided
	if (!hasWorldFile && formData.acts.length === 0 && formData.characters.length === 0) {
		errors.push({
			field: 'form',
			message: ls('features.importWorld.validations.contentRequired'),
		});
	}

	// Validate retry settings
	if (formData.retryCount < 0 || formData.retryCount > 20) {
		errors.push({
			field: 'retryCount',
			message: ls('features.importWorld.validations.retryCountRange'),
		});
	}
	if (formData.backoffIntervalSeconds < 1 || formData.backoffIntervalSeconds > 60) {
		errors.push({
			field: 'backoffIntervalSeconds',
			message: ls('features.importWorld.validations.backoffIntervalRange'),
		});
	}

	// Validate file types for acts
	for (const act of formData.acts) {
		if (act.actFile && !isValidTextFile(act.actFile)) {
			errors.push({
				field: `act-${act.id}-file`,
				message: ls('features.importWorld.validations.fileMustBeMdOrTxt', { field: 'Act/chapter file' }),
			});
		}
		if (act.transcript && !isValidJsonFile(act.transcript)) {
			errors.push({
				field: `act-${act.id}-transcript`,
				message: ls('features.importWorld.validations.fileMustBeJson'),
			});
		}
	}

	// Validate character card file types
	for (const character of formData.characters) {
		if (character.cardFile && !isValidTextFile(character.cardFile)) {
			errors.push({
				field: `character-${character.id}-file`,
				message: ls('features.importWorld.validations.fileMustBeMdOrTxt', { field: 'Character card file' }),
			});
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
		warnings,
	};
}

export function hasRequiredActContent(
	act: ImportActInput,
	actIndex: number,
	totalActs: number,
	hasWorldFile: boolean,
	hasCharacterCards: boolean
): boolean {
	if (actIndex < totalActs - 1) {
		return act.transcript !== null;
	}
	return act.transcript !== null || act.actFile !== null || hasWorldFile || hasCharacterCards;
}

function isValidTextFile(file: File): boolean {
	const name = file.name.toLowerCase();
	return name.endsWith('.md') || name.endsWith('.txt');
}

function isValidJsonFile(file: File): boolean {
	return file.name.toLowerCase().endsWith('.json');
}
