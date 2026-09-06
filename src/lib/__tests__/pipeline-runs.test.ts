import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from './helpers/test-database';
import { runMigrations } from '$lib/db/migrations';

let testDb: ReturnType<typeof createTestDatabase>;

vi.mock('$lib/db/database', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

import * as pipelineRuns from '$lib/db/pipeline-runs';
import type { PipelineRunRecord } from '$lib/db/pipeline-runs';

function makeRun(overrides: Partial<PipelineRunRecord> = {}): PipelineRunRecord {
	return {
		messageId: 'msg-1',
		actLineId: 'line-1',
		storyId: 'story-1',
		kind: 'main',
		state: { writerOutput: 'draft text' },
		phaseMetadata: [
			{
				phaseName: 'WRITER',
				model: 'test-model',
				finishReason: 'stop',
				inputTokens: 10,
				outputTokens: 20,
				totalTokens: 30,
				durationMs: 1000,
			},
		],
		inputSnapshot: { directorNotes: 'be dramatic', completedScenes: 3, playerMessageId: 'user-msg-1' },
		createdAt: 1000,
		updatedAt: 2000,
		...overrides,
	};
}

describe('pipeline_runs CRUD', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('creates the pipeline_runs table via migration', () => {
		const tables = testDb._db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
		expect(tables.map((t) => t.name)).toContain('pipeline_runs');
	});

	it('inserts and retrieves a run by act line', async () => {
		await pipelineRuns.upsertPipelineRun(makeRun());
		const loaded = await pipelineRuns.getPipelineRunForActLine('line-1');
		expect(loaded).not.toBeNull();
		expect(loaded!.messageId).toBe('msg-1');
		expect(loaded!.kind).toBe('main');
		expect(loaded!.state.writerOutput).toBe('draft text');
		expect(loaded!.phaseMetadata).toHaveLength(1);
		expect(loaded!.phaseMetadata[0].phaseName).toBe('WRITER');
		expect(loaded!.inputSnapshot.directorNotes).toBe('be dramatic');
		expect(loaded!.inputSnapshot.playerMessageId).toBe('user-msg-1');
	});

	it('returns null when no run exists for the act line', async () => {
		expect(await pipelineRuns.getPipelineRunForActLine('missing')).toBeNull();
	});

	it('retrieves a run by message id', async () => {
		await pipelineRuns.upsertPipelineRun(makeRun());
		expect((await pipelineRuns.getPipelineRun('msg-1'))?.actLineId).toBe('line-1');
		expect(await pipelineRuns.getPipelineRun('missing')).toBeNull();
	});

	it('upsert updates state in place without duplicating rows', async () => {
		await pipelineRuns.upsertPipelineRun(makeRun());
		await pipelineRuns.upsertPipelineRun(makeRun({ state: { writerOutput: 'v2', editorOutput: 'edited' }, updatedAt: 3000 }));

		const loaded = await pipelineRuns.getPipelineRunForActLine('line-1');
		expect(loaded!.state.editorOutput).toBe('edited');
		expect(loaded!.updatedAt).toBe(3000);
		expect(loaded!.createdAt).toBe(1000);
	});

	it('updatePipelineRunIfExists returns true and updates when the row exists', async () => {
		await pipelineRuns.upsertPipelineRun(makeRun());
		const updated = await pipelineRuns.updatePipelineRunIfExists(makeRun({ state: { editorOutput: 'committed' }, updatedAt: 5000 }));
		expect(updated).toBe(true);
		const loaded = await pipelineRuns.getPipelineRun('msg-1');
		expect(loaded!.state.editorOutput).toBe('committed');
		expect(loaded!.updatedAt).toBe(5000);
	});

	it('updatePipelineRunIfExists returns false when the row was deleted externally', async () => {
		await pipelineRuns.upsertPipelineRun(makeRun());
		await pipelineRuns.deletePipelineRun('msg-1');
		const updated = await pipelineRuns.updatePipelineRunIfExists(makeRun({ state: { editorOutput: 'x' } }));
		expect(updated).toBe(false);
		// The row must not be resurrected by the update
		expect(await pipelineRuns.getPipelineRun('msg-1')).toBeNull();
	});

	it('deletes runs by act via act_line_meta membership', async () => {
		await testDb.execute('INSERT INTO act_line_meta (id, act_id, name, is_main_line, created_at) VALUES ($1, $2, $3, $4, $5)', [
			'line-1',
			'act-1',
			'Main',
			1,
			0,
		]);
		await testDb.execute('INSERT INTO act_line_meta (id, act_id, name, is_main_line, created_at) VALUES ($1, $2, $3, $4, $5)', [
			'line-2',
			'act-2',
			'Main',
			1,
			0,
		]);
		await pipelineRuns.upsertPipelineRun(makeRun({ messageId: 'msg-1', actLineId: 'line-1' }));
		await pipelineRuns.upsertPipelineRun(makeRun({ messageId: 'msg-2', actLineId: 'line-2' }));

		await pipelineRuns.deletePipelineRunsForAct('act-1');

		expect(await pipelineRuns.getPipelineRun('msg-1')).toBeNull();
		expect(await pipelineRuns.getPipelineRun('msg-2')).not.toBeNull();
	});

	it('deletes a run by message id', async () => {
		await pipelineRuns.upsertPipelineRun(makeRun());
		await pipelineRuns.deletePipelineRun('msg-1');
		expect(await pipelineRuns.getPipelineRunForActLine('line-1')).toBeNull();
	});

	it('deletes runs by act line and by story', async () => {
		await pipelineRuns.upsertPipelineRun(makeRun({ messageId: 'msg-1', actLineId: 'line-1' }));
		await pipelineRuns.upsertPipelineRun(makeRun({ messageId: 'msg-2', actLineId: 'line-2' }));
		await pipelineRuns.upsertPipelineRun(makeRun({ messageId: 'msg-3', actLineId: 'line-3', storyId: 'story-2' }));

		await pipelineRuns.deletePipelineRunsForActLine('line-1');
		expect(await pipelineRuns.getPipelineRun('msg-1')).toBeNull();
		expect(await pipelineRuns.getPipelineRun('msg-2')).not.toBeNull();

		await pipelineRuns.deletePipelineRunsForStory('story-1');
		expect(await pipelineRuns.getPipelineRun('msg-2')).toBeNull();
		expect(await pipelineRuns.getPipelineRun('msg-3')).not.toBeNull();
	});

	it('round-trips epilogue kind with ending type', async () => {
		await pipelineRuns.upsertPipelineRun(
			makeRun({ messageId: 'msg-e', kind: 'epilogue', inputSnapshot: { directorNotes: '', completedScenes: 5, endingType: 'good' } })
		);
		const loaded = await pipelineRuns.getPipelineRun('msg-e');
		expect(loaded!.kind).toBe('epilogue');
		expect(loaded!.inputSnapshot.endingType).toBe('good');
	});

	it('tolerates malformed JSON columns', async () => {
		await testDb.execute(
			`INSERT INTO pipeline_runs (message_id, act_line_id, story_id, kind, state, phase_metadata, input_snapshot, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			['msg-bad', 'line-bad', 'story-1', 'main', '{not json', null, '{not json', 1, 2]
		);
		const loaded = await pipelineRuns.getPipelineRunForActLine('line-bad');
		expect(loaded).not.toBeNull();
		expect(loaded!.state).toEqual({});
		expect(loaded!.phaseMetadata).toEqual([]);
		expect(loaded!.inputSnapshot.directorNotes).toBe('');
	});
});
