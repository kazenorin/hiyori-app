import { describe, it, expect, beforeEach } from 'vitest';
import {
	openSettingsDialog,
	closeSettingsDialog,
	isSettingsDialogOpen,
	getActiveSection,
	setActiveSection,
	DEFAULT_SECTION,
} from '$lib/features/settings/settings-dialog-state.svelte';

describe('settings-dialog-state', () => {
	beforeEach(() => {
		closeSettingsDialog();
		setActiveSection(DEFAULT_SECTION);
	});

	it('starts closed', () => {
		expect(isSettingsDialogOpen()).toBe(false);
	});

	it('opens on the AI Providers landing section by default', () => {
		openSettingsDialog();
		expect(isSettingsDialogOpen()).toBe(true);
		expect(getActiveSection()).toBe('providers');
	});

	it('opens a specific section when requested', () => {
		openSettingsDialog('tts');
		expect(isSettingsDialogOpen()).toBe(true);
		expect(getActiveSection()).toBe('tts');
	});

	it('remembers the last-visited section across close/reopen', () => {
		openSettingsDialog();
		setActiveSection('data');
		closeSettingsDialog();
		openSettingsDialog();
		expect(getActiveSection()).toBe('data');
	});

	it('closes without resetting the active section', () => {
		openSettingsDialog('cloudSync');
		closeSettingsDialog();
		expect(isSettingsDialogOpen()).toBe(false);
		expect(getActiveSection()).toBe('cloudSync');
	});
});
