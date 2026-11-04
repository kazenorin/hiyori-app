import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from './helpers/test-database';
import { runMigrations } from '#lib/db/migrations';

let testDb: ReturnType<typeof createTestDatabase>;

vi.mock('#lib/db/database', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

import * as messagePhases from '#lib/db/message-phases';
import * as stories from '#lib/db/stories';
import * as acts from '#lib/db/acts';
import * as actLines from '#lib/db/act-lines';
import * as messages from '#lib/db/messages';
import type { UIScenePhase } from '#lib/ai/narrative-types';

function makePhases(): UIScenePhase[] {
	return [
		{ phaseName: 'WRITER', content: 'draft text' },
		{ phaseName: 'REVIEWER', content: 'review notes', reasoning: 'why not' },
		{ phaseName: 'EDITOR', content: 'polished prose' },
	];
}

describe('message_phases CRUD', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('creates the message_phases table via migration', () => {
		const tables = testDb._db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
		expect(tables.map((t) => t.name)).toContain('message_phases');
	});

	it('round-trips phases in pipeline order with reasoning', async () => {
		await messagePhases.upsertMessagePhases('msg-1', makePhases());

		const loaded = await messagePhases.getPhasesForMessages(['msg-1']);
		expect(loaded.get('msg-1')).toEqual(makePhases());
	});

	it('upsert replaces phase content in place and lets the async chain add a phase', async () => {
		// Main settle writes the first batch; async settle re-sends the full array
		// with updated EDITOR content plus a SUMMARIZER row — both upserts must be
		// idempotent per phase so ordering between them is safe.
		await messagePhases.upsertMessagePhases('msg-1', makePhases());
		await messagePhases.upsertMessagePhases('msg-1', [
			{ phaseName: 'WRITER', content: 'draft text' },
			{ phaseName: 'REVIEWER', content: 'review notes', reasoning: 'why not' },
			{ phaseName: 'EDITOR', content: 'edited prose', reasoning: 'editor thoughts' },
			{ phaseName: 'SUMMARIZER', content: 'act summary' },
		]);

		const loaded = await messagePhases.getPhasesForMessages(['msg-1']);
		const phases = loaded.get('msg-1')!;
		expect(phases).toHaveLength(4);
		expect(phases[2]).toEqual({ phaseName: 'EDITOR', content: 'edited prose', reasoning: 'editor thoughts' });
		expect(phases[3]).toEqual({ phaseName: 'SUMMARIZER', content: 'act summary' });
	});

	it('returns a map keyed by message id covering multiple messages', async () => {
		await messagePhases.upsertMessagePhases('msg-1', makePhases());
		await messagePhases.upsertMessagePhases('msg-2', [{ phaseName: 'GAME_MASTER', content: 'gm output' }]);

		const loaded = await messagePhases.getPhasesForMessages(['msg-1', 'msg-2', 'msg-missing']);
		expect(loaded.get('msg-1')).toHaveLength(3);
		expect(loaded.get('msg-2')).toEqual([{ phaseName: 'GAME_MASTER', content: 'gm output' }]);
		expect(loaded.has('msg-missing')).toBe(false);
	});

	it('returns an empty map for no ids without hitting the database', async () => {
		const selectSpy = vi.spyOn(testDb, 'select');
		const loaded = await messagePhases.getPhasesForMessages([]);
		expect(loaded.size).toBe(0);
		expect(selectSpy).not.toHaveBeenCalled();
	});

	it('chunks large id batches to stay within the SQLite variable limit', async () => {
		// SQLite historically caps bound variables per statement (999; the project
		// standardizes on 90), so a >90-id batch must be split across queries.
		const ids = Array.from({ length: 95 }, (_, i) => `msg-${i}`);
		await messagePhases.upsertMessagePhases(ids[0], [{ phaseName: 'WRITER', content: 'seed' }]);

		const selectSpy = vi.spyOn(testDb, 'select');
		const loaded = await messagePhases.getPhasesForMessages(ids);
		expect(selectSpy).toHaveBeenCalledTimes(2);
		expect(loaded.get(ids[0])).toEqual([{ phaseName: 'WRITER', content: 'seed' }]);
		expect(loaded.size).toBe(1);
	});

	it('deletes phases only for the given messages', async () => {
		await messagePhases.upsertMessagePhases('msg-1', makePhases());
		await messagePhases.upsertMessagePhases('msg-2', [{ phaseName: 'WRITER', content: 'other' }]);

		await messagePhases.deletePhasesForMessages(['msg-1']);

		const loaded = await messagePhases.getPhasesForMessages(['msg-1', 'msg-2']);
		expect(loaded.has('msg-1')).toBe(false);
		expect(loaded.get('msg-2')).toHaveLength(1);
	});

	it('stores phases without reasoning as rows whose reasoning reads back absent', async () => {
		await messagePhases.upsertMessagePhases('msg-1', [{ phaseName: 'PLOT_PLANNER', content: 'plan' }]);
		const rows = testDb._db.prepare('SELECT reasoning FROM message_phases WHERE message_id = ?').all('msg-1') as Array<{
			reasoning: string | null;
		}>;
		expect(rows[0].reasoning).toBeNull();

		const loaded = await messagePhases.getPhasesForMessages(['msg-1']);
		expect(loaded.get('msg-1')![0]).not.toHaveProperty('reasoning');
	});

	describe('phase cleanup on hard message deletion', () => {
		beforeEach(async () => {
			await stories.createStory('story-1', 'Test', 'en');
			await acts.createAct('act-1', 'story-1', 'Act 1', 1);
		});

		// WHY: phase rows have no FK cascade; deleting a message without its phases
		// leaves orphans that resurrect whenever the same id is re-inserted
		// (sync fast-forward, overwrite load).
		it('deleteActLine removes phases of solely-referenced messages', async () => {
			await actLines.createActLine('line-1', 'act-1', 'Main', true);
			await messages.createMessage({ id: 'm1', role: 'assistant', content: 'scene' });
			await actLines.addMessageToLine('line-1', 'm1', 1);
			await messagePhases.upsertMessagePhases('m1', makePhases());

			await actLines.deleteActLine('line-1');

			expect((await messagePhases.getPhasesForMessages(['m1'])).size).toBe(0);
		});

		// WHY: forked lines share message rows — deleting one line must not strip
		// phases that the surviving line still renders.
		it('deleteActLine keeps phases of messages shared with another line', async () => {
			await actLines.createActLine('line-1', 'act-1', 'Main', true);
			await actLines.createActLine('line-2', 'act-1', 'Fork', false);
			await messages.createMessage({ id: 'shared', role: 'assistant', content: 'scene' });
			await actLines.addMessageToLine('line-1', 'shared', 1);
			await actLines.addMessageToLine('line-2', 'shared', 1);
			await messagePhases.upsertMessagePhases('shared', makePhases());

			await actLines.deleteActLine('line-1');

			expect((await messagePhases.getPhasesForMessages(['shared'])).get('shared')).toHaveLength(3);
		});

		it('deleteMessage removes its phases', async () => {
			await messages.createMessage({ id: 'm3', role: 'assistant', content: 'scene' });
			await messagePhases.upsertMessagePhases('m3', makePhases());

			await messages.deleteMessage('m3');

			expect((await messagePhases.getPhasesForMessages(['m3'])).size).toBe(0);
		});
	});
});
