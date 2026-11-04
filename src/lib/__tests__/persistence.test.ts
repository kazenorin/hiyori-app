import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from './helpers/test-database';
import { runMigrations } from '#lib/db/migrations';

let testDb: ReturnType<typeof createTestDatabase>;

vi.mock('#lib/db/database', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

vi.mock('#lib/logging/logger', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));

vi.mock('#lib/features/memory', () => ({ Memory: class {} }));
vi.mock('#lib/stores/stories.svelte', () => ({ getActiveStoryId: () => null }));
vi.mock('#lib/stores/settings.svelte', () => ({
	getMemoryProviderConfig: () => undefined,
	isMemoryAvailable: () => false,
	isInventoryAvailable: () => false,
}));
vi.mock('#lib/db/inventory', () => ({ deleteInventoryByMessages: vi.fn(async () => {}) }));

import * as dbActLines from '#lib/db/act-lines';
import * as dbMessages from '#lib/db/messages';
import * as dbMessagePhases from '#lib/db/message-phases';
import { loadActLineMessagesFromDB, removeMessagesById } from '#lib/ai/chat/persistence';
import type { UIScenePhase } from '#lib/ai/narrative-types';

const phases: UIScenePhase[] = [
	{ phaseName: 'EDITOR', content: 'polished prose', reasoning: 'thoughts' },
	{ phaseName: 'GAME_MASTER', content: 'gm output' },
];

async function seedLine() {
	await dbMessages.createMessage({ id: 'm1', role: 'assistant', content: 'scene one', sceneNumber: 1 });
	await dbMessages.createMessage({ id: 'm2', role: 'assistant', content: 'scene two', sceneNumber: 2 });
	await dbActLines.addMessageToLine('line-1', 'm1', 0);
	await dbActLines.addMessageToLine('line-1', 'm2', 1);
	await dbMessagePhases.upsertMessagePhases('m1', phases);
	await dbMessagePhases.upsertMessagePhases('m2', [{ phaseName: 'SUMMARIZER', content: 'summary' }]);
}

describe('loadActLineMessagesFromDB phase attachment', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('attaches persisted phases to each loaded message so strips/dialogs survive reload', async () => {
		await seedLine();

		const messages = await loadActLineMessagesFromDB('line-1');

		expect(messages).toHaveLength(2);
		expect(messages[0].phases).toEqual(phases);
		expect(messages[1].phases).toEqual([{ phaseName: 'SUMMARIZER', content: 'summary' }]);
	});

	it('leaves phases undefined for messages without rows (pre-feature messages, user messages)', async () => {
		await dbMessages.createMessage({ id: 'u1', role: 'user', content: 'player input', sceneNumber: 1 });
		await dbActLines.addMessageToLine('line-1', 'u1', 0);

		const messages = await loadActLineMessagesFromDB('line-1');

		expect(messages).toHaveLength(1);
		expect(messages[0].phases).toBeUndefined();
	});
});

describe('removeMessagesById phase cleanup', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('deletes phase rows for removed messages and keeps the rest', async () => {
		await seedLine();

		const success = await removeMessagesById('line-1', ['m1']);

		expect(success).toBe(true);
		const remaining = await dbMessagePhases.getPhasesForMessages(['m1', 'm2']);
		expect(remaining.has('m1')).toBe(false);
		expect(remaining.get('m2')).toHaveLength(1);
	});

	it('keeps phase rows for messages still referenced by another act line (forked lines)', async () => {
		// Forked lines share messages; removing one line's entry must not destroy
		// the phases the other line still displays.
		await seedLine();
		await dbActLines.addMessageToLine('line-2', 'm1', 0);

		const success = await removeMessagesById('line-1', ['m1']);

		expect(success).toBe(true);
		const remaining = await dbMessagePhases.getPhasesForMessages(['m1']);
		expect(remaining.get('m1')).toEqual(phases);
	});
});
