import { describe, it, expect, beforeEach } from 'vitest';
import { mobileFeatures } from '#lib/stores/mobile-nav.svelte';
import {
	openPhaseDialog,
	closePhaseDialog,
	getPhaseDialogOpen,
	getPhaseDialogMessageId,
	getPhaseDialogSelection,
	setPhaseDialogSelection,
	openContext,
	openContextDialog,
	closeContextDialog,
	getContextDialogOpen,
	getContextDialogMessageId,
	getContextDialogSelection,
	setContextDialogSelection,
} from '#lib/components/chat/phase-dialog-state.svelte';

beforeEach(() => {
	closePhaseDialog();
	closeContextDialog();
	mobileFeatures.isPhone = false;
});

describe('phase dialog selection', () => {
	it('opens on a phase selection and keeps the existing openPhaseDialog signature', () => {
		openPhaseDialog('msg-1', 'EDITOR');
		expect(getPhaseDialogOpen()).toBe(true);
		expect(getPhaseDialogMessageId()).toBe('msg-1');
		expect(getPhaseDialogSelection()).toEqual({ kind: 'phase', phase: 'EDITOR' });
	});

	it('switches selection without changing the bound message', () => {
		openPhaseDialog('msg-1', 'WRITER');
		setPhaseDialogSelection({ kind: 'phase', phase: 'GAME_MASTER' });
		expect(getPhaseDialogSelection()).toEqual({ kind: 'phase', phase: 'GAME_MASTER' });
		expect(getPhaseDialogMessageId()).toBe('msg-1');
	});

	it('can hold a context selection, which the old PhaseName-only state could not represent', () => {
		openPhaseDialog('msg-1', 'WRITER');
		setPhaseDialogSelection({ kind: 'context', context: 'scenePlot' });
		expect(getPhaseDialogSelection()).toEqual({ kind: 'context', context: 'scenePlot' });
	});
});

describe('openContext dispatch', () => {
	it('on wide screens reuses the shared phase dialog, so context sits beside the phases', () => {
		mobileFeatures.isPhone = false;
		openContext('msg-2', 'storySoFar');
		expect(getPhaseDialogOpen()).toBe(true);
		expect(getPhaseDialogMessageId()).toBe('msg-2');
		expect(getPhaseDialogSelection()).toEqual({ kind: 'context', context: 'storySoFar' });
		expect(getContextDialogOpen()).toBe(false);
	});

	it('on narrow screens opens the dedicated dialog and leaves the phase dialog closed', () => {
		// The narrow phase dialog cannot represent a context selection, so the two must stay separate.
		mobileFeatures.isPhone = true;
		openContext('msg-3', 'scenePlot');
		expect(getContextDialogOpen()).toBe(true);
		expect(getContextDialogMessageId()).toBe('msg-3');
		expect(getContextDialogSelection()).toBe('scenePlot');
		expect(getPhaseDialogOpen()).toBe(false);
	});

	it('keeps the two dialogs independently reachable on narrow screens', () => {
		mobileFeatures.isPhone = true;
		openPhaseDialog('msg-4', 'REVIEWER');
		openContextDialog('msg-4', 'storySoFar');
		expect(getPhaseDialogOpen()).toBe(true);
		expect(getContextDialogOpen()).toBe(true);
		closeContextDialog();
		expect(getPhaseDialogOpen()).toBe(true);
		expect(getContextDialogOpen()).toBe(false);
	});

	it('switches the narrow dialog selection without rebinding the message', () => {
		openContextDialog('msg-5', 'storySoFar');
		setContextDialogSelection('scenePlot');
		expect(getContextDialogSelection()).toBe('scenePlot');
		expect(getContextDialogMessageId()).toBe('msg-5');
	});
});
