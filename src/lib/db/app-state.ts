import { getDatabase } from './database';

export interface AppState {
	activeStoryId: string | null;
	activeActId: string | null;
	activeActLineId: string | null;
}

interface AppStateRow {
	active_story_id: string | null;
	active_act_id: string | null;
	active_act_line_id: string | null;
}

export async function getAppState(): Promise<AppState> {
	const db = getDatabase();
	const rows = await db.select<AppStateRow[]>(
		'SELECT active_story_id, active_act_id, active_act_line_id FROM app_state WHERE id = 1'
	);
	return rows.length > 0
		? {
				activeStoryId: rows[0].active_story_id,
				activeActId: rows[0].active_act_id,
				activeActLineId: rows[0].active_act_line_id
			}
		: { activeStoryId: null, activeActId: null, activeActLineId: null };
}

export async function setActiveStory(storyId: string | null): Promise<void> {
	const db = getDatabase();
	await db.execute(
		'UPDATE app_state SET active_story_id = $1, active_act_id = NULL, active_act_line_id = NULL WHERE id = 1',
		[storyId]
	);
}

export async function setActiveAct(actId: string | null): Promise<void> {
	const db = getDatabase();
	await db.execute(
		'UPDATE app_state SET active_act_id = $1, active_act_line_id = NULL WHERE id = 1',
		[actId]
	);
}

export async function setActiveActLine(actLineId: string | null): Promise<void> {
	const db = getDatabase();
	await db.execute(
		'UPDATE app_state SET active_act_line_id = $1 WHERE id = 1',
		[actLineId]
	);
}

export async function setActiveAll(
	storyId: string | null,
	actId: string | null,
	actLineId: string | null
): Promise<void> {
	const db = getDatabase();
	await db.execute(
		'UPDATE app_state SET active_story_id = $1, active_act_id = $2, active_act_line_id = $3 WHERE id = 1',
		[storyId, actId, actLineId]
	);
}