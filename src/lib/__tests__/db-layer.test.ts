import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from './helpers/test-database';
import { runMigrations } from '$lib/db/migrations';

// Create a shared test database instance
let testDb: ReturnType<typeof createTestDatabase>;

vi.mock('$lib/db/database', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
}));

import * as stories from '$lib/db/stories';
import * as acts from '$lib/db/acts';
import * as actLines from '$lib/db/act-lines';
import * as messages from '$lib/db/messages';
import * as appState from '$lib/db/app-state';
import * as storyFolders from '$lib/db/story-folders';

describe('migrations', () => {
	beforeEach(() => {
		testDb = createTestDatabase();
	});

	afterEach(() => {
		testDb.close();
	});

	it('runs all migrations and creates tables', async () => {
		await runMigrations();
		const tables = testDb._db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
		const tableNames = tables.map((t) => t.name);
		expect(tableNames).toContain('stories');
		expect(tableNames).toContain('acts');
		expect(tableNames).toContain('messages');
		expect(tableNames).toContain('act_line_meta');
		expect(tableNames).toContain('act_lines');
		expect(tableNames).toContain('app_state');
		expect(tableNames).toContain('story_folders');
		expect(tableNames).toContain('schema_version');
	});

	it('is idempotent - running twice does not error', async () => {
		await runMigrations();
		await runMigrations();
		const versions = testDb._db.prepare('SELECT version FROM schema_version ORDER BY version').all();
		expect(versions).toHaveLength(2);
	});
});

describe('stories CRUD', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('creates and retrieves a story', async () => {
		const story = await stories.createStory('id-1', 'My Story');
		expect(story.name).toBe('My Story');
		expect(story.id).toBe('id-1');

		const fetched = await stories.getStory('id-1');
		expect(fetched).not.toBeNull();
		expect(fetched!.name).toBe('My Story');
	});

	it('returns null for nonexistent story', async () => {
		expect(await stories.getStory('nope')).toBeNull();
	});

	it('returns all stories sorted by updated_at DESC', async () => {
		await stories.createStory('id-1', 'First');
		// Ensure different timestamps (Date.now() in same tick returns same value)
		const db = testDb._db;
		db.prepare('UPDATE stories SET updated_at = updated_at - 1').run();
		await stories.createStory('id-2', 'Second');

		const all = await stories.getAllStories();
		expect(all).toHaveLength(2);
		expect(all[0].id).toBe('id-2');
	});

	it('updates a story name', async () => {
		await stories.createStory('id-1', 'Original');
		await stories.updateStory('id-1', 'Updated');
		expect((await stories.getStory('id-1'))!.name).toBe('Updated');
	});

	it('deletes a story', async () => {
		await stories.createStory('id-1', 'Bye');
		await stories.deleteStory('id-1');
		expect(await stories.getStory('id-1')).toBeNull();
	});
});

describe('acts CRUD', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		await stories.createStory('story-1', 'Test');
	});

	afterEach(() => {
		testDb.close();
	});

	it('creates an act with auto-incrementing number', async () => {
		const act1 = await acts.createAct('act-1', 'story-1', 'Act 1', 1);
		expect(act1.actNumber).toBe(1);
		expect(act1.continuesFromActLineId).toBeNull();

		const next = await acts.getNextActNumber('story-1');
		expect(next).toBe(2);
	});

	it('returns 1 for getNextActNumber when no acts exist', async () => {
		expect(await acts.getNextActNumber('story-1')).toBe(1);
	});

	it('gets acts sorted by act_number ASC', async () => {
		await acts.createAct('act-1', 'story-1', 'Act 1', 1);
		await acts.createAct('act-2', 'story-1', 'Act 2', 2);

		const all = await acts.getActsForStory('story-1');
		expect(all[0].actNumber).toBe(1);
		expect(all[1].actNumber).toBe(2);
	});

	it('creates act with continuation', async () => {
		const act = await acts.createAct('act-2', 'story-1', 'Cont', 2, 'line-1');
		expect(act.continuesFromActLineId).toBe('line-1');
	});
});

describe('act-lines operations', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		await stories.createStory('story-1', 'Test');
		await acts.createAct('act-1', 'story-1', 'Act 1', 1);
	});

	afterEach(() => {
		testDb.close();
	});

	it('creates an act line with isMainLine', async () => {
		const line = await actLines.createActLine('line-1', 'act-1', 'main', true);
		expect(line.isMainLine).toBe(true);
	});

	it('gets main line for act', async () => {
		await actLines.createActLine('line-1', 'act-1', 'side', false);
		await actLines.createActLine('line-2', 'act-1', 'main', true);
		expect((await actLines.getMainLineForAct('act-1'))!.id).toBe('line-2');
	});

	it('adds and retrieves messages for a line', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Hello' });
		await messages.createMessage({ id: 'msg-2', role: 'assistant', content: 'Hi' });
		await actLines.addMessageToLine('line-1', 'msg-1', 1);
		await actLines.addMessageToLine('line-1', 'msg-2', 2);

		const msgs = await actLines.getMessagesForLine('line-1');
		expect(msgs).toHaveLength(2);
		expect(msgs[0].content).toBe('Hello');
		expect(msgs[1].content).toBe('Hi');
	});

	it('gets next sequence number', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'test' });
		await actLines.addMessageToLine('line-1', 'msg-1', 1);
		expect(await actLines.getNextSequence('line-1')).toBe(2);
	});

	it('removes specified messages from act line', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Keep' });
		await messages.createMessage({ id: 'msg-2', role: 'assistant', content: 'Remove' });
		await messages.createMessage({ id: 'msg-3', role: 'user', content: 'Also remove' });
		await actLines.addMessageToLine('line-1', 'msg-1', 1);
		await actLines.addMessageToLine('line-1', 'msg-2', 2);
		await actLines.addMessageToLine('line-1', 'msg-3', 3);

		await actLines.removeMessagesFromActLine('line-1', ['msg-2', 'msg-3']);
		const msgs = await actLines.getMessagesForLine('line-1');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].content).toBe('Keep');
	});

	it('does nothing when messageIds is empty', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Keep' });
		await actLines.addMessageToLine('line-1', 'msg-1', 1);

		await actLines.removeMessagesFromActLine('line-1', []);
		const msgs = await actLines.getMessagesForLine('line-1');
		expect(msgs).toHaveLength(1);
	});

	it('does not delete shared message when other line still references it', async () => {
		// Create shared messages
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Shared User' });
		await messages.createMessage({
			id: 'msg-2',
			role: 'assistant',
			content: 'Shared Assistant',
			variables: {
				sceneTitle: null,
				background: null,
				narrativeBody: null,
				cg: null,
				gameData: {
					activePlotThreads: [],
					decisionContext: null,
					decisions: ['A', 'B'],
				},
			},
		});
		await actLines.addMessageToLine('line-1', 'msg-1', 1);
		await actLines.addMessageToLine('line-1', 'msg-2', 2);

		// Fork from line-1 at sequence 2 (copies msg-1 and msg-2)
		await actLines.branchFromLine('line-2', 'line-1', 2, 'act-1', 'fork');

		// Add extra message to line-1 only
		await messages.createMessage({ id: 'msg-3', role: 'assistant', content: 'Only on line-1' });
		await actLines.addMessageToLine('line-1', 'msg-3', 3);

		// Remove msg-3 from line-1 (should delete msg-3, but NOT msg-2 since line-2 still references it)
		await actLines.removeMessagesFromActLine('line-1', ['msg-3']);

		// Verify msg-3 was deleted (only line-1 referenced it)
		expect(await messages.getMessage('msg-3')).toBeNull();

		// Verify msg-2 still exists (line-2 still references it)
		const msg2 = await messages.getMessage('msg-2');
		expect(msg2).not.toBeNull();
		expect(msg2!.variables?.gameData).toEqual({
			activePlotThreads: [],
			decisionContext: null,
			decisions: ['A', 'B'],
		});

		// Verify line-1 no longer has msg-3
		const line1Msgs = await actLines.getMessagesForLine('line-1');
		expect(line1Msgs).toHaveLength(2);
		expect(line1Msgs.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);

		// Verify line-2 still has msg-1 and msg-2 with game data in variables
		const line2Msgs = await actLines.getMessagesForLine('line-2');
		expect(line2Msgs).toHaveLength(2);
		expect(line2Msgs[1].variables?.gameData).toEqual({
			activePlotThreads: [],
			decisionContext: null,
			decisions: ['A', 'B'],
		});
	});

	it('deletes message when no other line references it', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Solo' });
		await actLines.addMessageToLine('line-1', 'msg-1', 1);

		await actLines.removeMessagesFromActLine('line-1', ['msg-1']);

		expect(await messages.getMessage('msg-1')).toBeNull();
	});

	it('preserves variables for shared messages after delete on one line', async () => {
		await messages.createMessage({
			id: 'msg-1',
			role: 'assistant',
			content: 'Content',
			variables: {
				sceneTitle: null,
				background: null,
				narrativeBody: null,
				cg: null,
				gameData: {
					activePlotThreads: [],
					decisionContext: null,
					decisions: ['X'],
				},
			},
		});
		await actLines.addMessageToLine('line-1', 'msg-1', 1);
		await actLines.addMessageToLine('line-2', 'msg-1', 1);

		// Delete from line-1 only
		await actLines.removeMessagesFromActLine('line-1', ['msg-1']);

		// Message should still exist and line-2 should still have it with game data
		const msg = await messages.getMessage('msg-1');
		expect(msg).not.toBeNull();
		expect(msg!.variables?.gameData).toEqual({
			activePlotThreads: [],
			decisionContext: null,
			decisions: ['X'],
		});

		const line2Msgs = await actLines.getMessagesForLine('line-2');
		expect(line2Msgs).toHaveLength(1);
		expect(line2Msgs[0].variables?.gameData).toEqual({
			activePlotThreads: [],
			decisionContext: null,
			decisions: ['X'],
		});
	});

	it('branches from a line copying messages up to sequence', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Q1' });
		await messages.createMessage({ id: 'msg-2', role: 'assistant', content: 'A1' });
		await messages.createMessage({ id: 'msg-3', role: 'user', content: 'Q2' });
		await actLines.addMessageToLine('line-1', 'msg-1', 1);
		await actLines.addMessageToLine('line-1', 'msg-2', 2);
		await actLines.addMessageToLine('line-1', 'msg-3', 3);

		const branch = await actLines.branchFromLine('line-2', 'line-1', 2, 'act-1', 'fork');
		expect(branch.id).toBe('line-2');
		expect(branch.isMainLine).toBe(false);

		const branchMsgs = await actLines.getMessagesForLine('line-2');
		expect(branchMsgs).toHaveLength(2);
	});

	it('updates an act line name', async () => {
		await actLines.createActLine('line-1', 'act-1', 'original name', false);
		expect((await actLines.getActLine('line-1'))!.name).toBe('original name');

		await actLines.updateActLine('line-1', 'renamed');
		expect((await actLines.getActLine('line-1'))!.name).toBe('renamed');
	});

	it('gets act lines for an act sorted by created_at', async () => {
		await actLines.createActLine('line-1', 'act-1', 'first', false);
		await actLines.createActLine('line-2', 'act-1', 'second', false);

		const lines = await actLines.getActLinesForAct('act-1');
		expect(lines).toHaveLength(2);
		expect(lines[0].id).toBe('line-1');
		expect(lines[1].id).toBe('line-2');
	});

	it('deletes an act line', async () => {
		await actLines.createActLine('line-1', 'act-1', 'bye', false);
		await actLines.deleteActLine('line-1');
		expect(await actLines.getActLine('line-1')).toBeNull();
	});

	it('gets message sequence for a message in a line', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'test' });
		await actLines.addMessageToLine('line-1', 'msg-1', 5);
		expect(await actLines.getMessageSequence('line-1', 'msg-1')).toBe(5);
	});

	it('returns null for message not in line', async () => {
		expect(await actLines.getMessageSequence('line-1', 'nope')).toBeNull();
	});

	it('falls back to first line by creation when no main line', async () => {
		await actLines.createActLine('line-1', 'act-1', 'first', false);
		await actLines.createActLine('line-2', 'act-1', 'second', false);

		const main = await actLines.getMainLineForAct('act-1');
		expect(main!.id).toBe('line-1');
	});

	it('returns null when no lines exist for act', async () => {
		expect(await actLines.getMainLineForAct('act-1')).toBeNull();
	});
});

describe('act_line_premises operations', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		await stories.createStory('story-1', 'Test');
		await acts.createAct('act-1', 'story-1', 'Act 1', 1);
	});

	afterEach(() => {
		testDb.close();
	});

	it('adds and retrieves messages for premises', async () => {
		await actLines.createActLine('line-1', 'act-1', 'main', true);
		await messages.createMessage({ id: 'msg-1', role: 'assistant', content: 'What kind of story?' });
		await messages.createMessage({ id: 'msg-2', role: 'user', content: 'A mystery thriller' });
		await actLines.addMessageToPremises('line-1', 'msg-1', 1);
		await actLines.addMessageToPremises('line-1', 'msg-2', 2);

		const msgs = await actLines.getPremisesMessages('line-1');
		expect(msgs).toHaveLength(2);
		expect(msgs[0].content).toBe('What kind of story?');
		expect(msgs[1].content).toBe('A mystery thriller');
	});

	it('returns empty array when no premises exist', async () => {
		await actLines.createActLine('line-1', 'act-1', 'main', true);
		const msgs = await actLines.getPremisesMessages('line-1');
		expect(msgs).toHaveLength(0);
	});

	it('gets next premises sequence', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'test' });
		await actLines.addMessageToPremises('line-1', 'msg-1', 1);
		expect(await actLines.getNextPremisesSequence('line-1')).toBe(2);
	});

	it('returns 1 for next sequence when no premises exist', async () => {
		expect(await actLines.getNextPremisesSequence('line-1')).toBe(1);
	});

	it('removes messages from premises', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Keep' });
		await messages.createMessage({ id: 'msg-2', role: 'assistant', content: 'Remove' });
		await actLines.addMessageToPremises('line-1', 'msg-1', 1);
		await actLines.addMessageToPremises('line-1', 'msg-2', 2);

		await actLines.removeMessagesFromPremises('line-1', ['msg-2']);
		const msgs = await actLines.getPremisesMessages('line-1');
		expect(msgs).toHaveLength(1);
		expect(msgs[0].content).toBe('Keep');
	});

	it('does not delete message when act_lines still references it', async () => {
		await actLines.createActLine('line-1', 'act-1', 'main', true);
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Shared' });
		await actLines.addMessageToPremises('line-1', 'msg-1', 1);
		await actLines.addMessageToLine('line-1', 'msg-1', 1);

		await actLines.removeMessagesFromPremises('line-1', ['msg-1']);

		// Message should still exist because act_lines still references it
		expect(await messages.getMessage('msg-1')).not.toBeNull();
	});

	it('deletes message when only premises referenced it', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Only premises' });
		await actLines.addMessageToPremises('line-1', 'msg-1', 1);

		await actLines.removeMessagesFromPremises('line-1', ['msg-1']);

		expect(await messages.getMessage('msg-1')).toBeNull();
	});

	it('does nothing when messageIds is empty', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Keep' });
		await actLines.addMessageToPremises('line-1', 'msg-1', 1);

		await actLines.removeMessagesFromPremises('line-1', []);
		const msgs = await actLines.getPremisesMessages('line-1');
		expect(msgs).toHaveLength(1);
	});
});

describe('messages CRUD', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('creates and retrieves a message', async () => {
		const msg = await messages.createMessage({
			id: 'msg-1',
			role: 'assistant',
			content: 'Reply',
			reasoning: 'thinking...',
			metadata: '{"model":"gpt-4"}',
		});
		expect(msg.content).toBe('Reply');
		expect(msg.reasoning).toBe('thinking...');
	});

	it('deletes a message', async () => {
		await messages.createMessage({ id: 'msg-1', role: 'user', content: 'Hello' });
		await messages.deleteMessage('msg-1');
		expect(await messages.getMessage('msg-1')).toBeNull();
	});

	it('creates and retrieves a message with scenePlot', async () => {
		const msg = await messages.createMessage({
			id: 'msg-sp',
			role: 'assistant',
			content: 'Scene text',
			scenePlot: 'The hero arrives at the castle',
		});
		expect(msg.scenePlot).toBe('The hero arrives at the castle');

		const fetched = await messages.getMessage('msg-sp');
		expect(fetched).not.toBeNull();
		expect(fetched!.scenePlot).toBe('The hero arrives at the castle');
	});

	it('creates message without scenePlot and it stays undefined', async () => {
		const msg = await messages.createMessage({
			id: 'msg-nosp',
			role: 'user',
			content: 'Hello',
		});
		expect(msg.scenePlot).toBeUndefined();

		const fetched = await messages.getMessage('msg-nosp');
		expect(fetched).not.toBeNull();
		expect(fetched!.scenePlot).toBeUndefined();
	});

	it('updates message fields with actSummary and scenePlot', async () => {
		await messages.createMessage({
			id: 'msg-upd',
			role: 'assistant',
			content: 'Initial',
		});

		await messages.updateMessageFields('msg-upd', {
			actSummary: 'Summary of act',
			scenePlot: 'Plot for scene',
		});

		const fetched = await messages.getMessage('msg-upd');
		expect(fetched).not.toBeNull();
		expect(fetched!.actSummary).toBe('Summary of act');
		expect(fetched!.scenePlot).toBe('Plot for scene');
	});

	it('updateMessageFields only updates specified fields', async () => {
		await messages.createMessage({
			id: 'msg-partial',
			role: 'assistant',
			content: 'Content',
			actSummary: 'Existing summary',
		});

		await messages.updateMessageFields('msg-partial', {
			scenePlot: 'New plot',
		});

		const fetched = await messages.getMessage('msg-partial');
		expect(fetched).not.toBeNull();
		expect(fetched!.actSummary).toBe('Existing summary');
		expect(fetched!.scenePlot).toBe('New plot');
	});
});

describe('app-state', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('setActiveStory cascades: clears act and actLine', async () => {
		await appState.setActiveAll('s1', 'a1', 'l1');
		await appState.setActiveStory('s2');
		const state = await appState.getAppState();
		expect(state.activeStoryId).toBe('s2');
		expect(state.activeActId).toBeNull();
		expect(state.activeActLineId).toBeNull();
	});

	it('setActiveAct cascades: clears actLine', async () => {
		await appState.setActiveAll('s1', 'a1', 'l1');
		await appState.setActiveAct('a2');
		const state = await appState.getAppState();
		expect(state.activeActId).toBe('a2');
		expect(state.activeActLineId).toBeNull();
	});

	it('setActiveActLine only updates actLine', async () => {
		await appState.setActiveAll('s1', 'a1', 'l1');
		await appState.setActiveActLine('l2');
		const state = await appState.getAppState();
		expect(state.activeStoryId).toBe('s1');
		expect(state.activeActId).toBe('a1');
		expect(state.activeActLineId).toBe('l2');
	});

	it('setActiveStory(null) clears everything', async () => {
		await appState.setActiveAll('s1', 'a1', 'l1');
		await appState.setActiveStory(null);
		const state = await appState.getAppState();
		expect(state.activeStoryId).toBeNull();
		expect(state.activeActId).toBeNull();
		expect(state.activeActLineId).toBeNull();
	});
});

describe('story-folders', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('returns null when no mapping exists', async () => {
		expect(await storyFolders.getStoryFolder('s1')).toBeNull();
	});

	it('sets and gets folder mapping', async () => {
		await storyFolders.setStoryFolder('s1', 'My Folder');
		expect(await storyFolders.getStoryFolder('s1')).toBe('My Folder');
	});

	it('updates folder on upsert', async () => {
		await storyFolders.setStoryFolder('s1', 'Old');
		await storyFolders.setStoryFolder('s1', 'New');
		expect(await storyFolders.getStoryFolder('s1')).toBe('New');
	});

	it('reverse lookup by folder name', async () => {
		await storyFolders.setStoryFolder('s1', 'Folder');
		expect(await storyFolders.getFolderOwner('Folder')).toBe('s1');
	});

	it('deletes folder mapping', async () => {
		await storyFolders.setStoryFolder('s1', 'F');
		await storyFolders.deleteStoryFolder('s1');
		expect(await storyFolders.getStoryFolder('s1')).toBeNull();
	});
});
