import { getDatabase } from './database';
import {
	type NarrativeVariables,
	type GameDataFields,
	emptyVariables,
	FIELD_DESCRIPTORS,
	emptyGameDataFields,
	setField,
} from '$lib/ai/narrative-types';

export interface MessageBase {
	role: 'user' | 'assistant';
	content: string;
}

export interface Message extends MessageBase {
	id: string;
	reasoning?: string;
	metadata?: string;
	sceneNumber?: number;
	actSummary?: string;
	scenePlot?: string;
	importantPhrases?: string;
	variables?: NarrativeVariables;
	createdAt: number;
}

export interface MessageRow {
	id: string;
	role: string;
	content: string;
	reasoning: string | null;
	metadata: string | null;
	variables: string | null;
	act_summary: string | null;
	scene_plot: string | null;
	important_phrases: string | null;
	scene_number: number | null;
	created_at: number;
}

export function mapRowToMessage(row: MessageRow): Message {
	return {
		id: row.id,
		role: row.role as 'user' | 'assistant',
		content: row.content,
		reasoning: row.reasoning ?? undefined,
		metadata: row.metadata ?? undefined,
		variables: parseVariables(row.variables),
		actSummary: row.act_summary ?? undefined,
		scenePlot: row.scene_plot ?? undefined,
		importantPhrases: row.important_phrases ?? undefined,
		sceneNumber: row.scene_number ?? undefined,
		createdAt: row.created_at,
	};
}

export function parseImportantPhrases(raw: string | null | undefined): string[] | undefined {
	if (!raw) return undefined;
	const phrases = raw.split('\n').filter(Boolean);
	return phrases.length > 0 ? phrases : undefined;
}

export function serializeImportantPhrases(phrases: string[]): string {
	return phrases.join('\n');
}

export function parseVariables(raw: string | null): NarrativeVariables | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			return undefined;
		}
		const result = emptyVariables();
		for (const desc of FIELD_DESCRIPTORS) {
			const value = parsed[desc.fieldName];
			if (typeof value === 'string') {
				setField(result, desc.fieldName, value);
			}
		}
		if (parsed.gameData && typeof parsed.gameData === 'object') {
			result.gameData = parseGameDataFields(parsed.gameData);
		}
		return result;
	} catch {
		return undefined;
	}
}

function parseGameDataFields(raw: Record<string, unknown>): GameDataFields {
	const gd = emptyGameDataFields();
	if (Array.isArray(raw.activePlotThreads)) {
		gd.activePlotThreads = raw.activePlotThreads.filter((d: unknown) => typeof d === 'string');
	}
	if (typeof raw.decisionContext === 'string') {
		gd.decisionContext = raw.decisionContext;
	}
	if (Array.isArray(raw.decisions)) {
		gd.decisions = raw.decisions.filter((d: unknown) => typeof d === 'string');
	}
	return gd;
}

export async function createMessage(message: Omit<Message, 'createdAt'>): Promise<Message> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute(
		`INSERT INTO messages (id, role, content, reasoning, metadata, variables, act_summary, scene_plot, important_phrases, scene_number, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		[
			message.id,
			message.role,
			message.content,
			message.reasoning ?? null,
			message.metadata ?? null,
			message.variables ? JSON.stringify(message.variables) : null,
			message.actSummary ?? null,
			message.scenePlot ?? null,
			message.importantPhrases ?? null,
			message.sceneNumber ?? null,
			now,
		]
	);
	return { ...message, createdAt: now };
}

/** Clone a message row with a new ID. Returns the cloned message, or null if source not found. */
export async function cloneMessage(sourceId: string, newId: string): Promise<Message | null> {
	const db = getDatabase();
	const rows = await db.select<MessageRow[]>('SELECT * FROM messages WHERE id = $1', [sourceId]);
	if (rows.length === 0) return null;
	const row = rows[0];
	await db.execute(
		`INSERT INTO messages (id, role, content, reasoning, metadata, variables, act_summary, scene_plot, important_phrases, scene_number, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		[
			newId,
			row.role,
			row.content,
			row.reasoning,
			row.metadata,
			row.variables,
			row.act_summary,
			row.scene_plot,
			row.important_phrases,
			row.scene_number,
			row.created_at,
		]
	);
	return mapRowToMessage({ ...row, id: newId });
}

export async function getMessage(id: string): Promise<Message | null> {
	const db = getDatabase();
	const rows = await db.select<MessageRow[]>('SELECT * FROM messages WHERE id = $1', [id]);
	return rows.length > 0 ? mapRowToMessage(rows[0]) : null;
}

export async function deleteMessage(id: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM messages WHERE id = $1', [id]);
}

export async function updateMessageFields(
	id: string,
	fields: { actSummary?: string; scenePlot?: string; importantPhrases?: string; variables?: string }
): Promise<void> {
	const updates: string[] = [];
	const values: unknown[] = [];
	let paramIdx = 1;

	if (fields.actSummary !== undefined) {
		updates.push(`act_summary = $${paramIdx++}`);
		values.push(fields.actSummary);
	}
	if (fields.scenePlot !== undefined) {
		updates.push(`scene_plot = $${paramIdx++}`);
		values.push(fields.scenePlot);
	}
	if (fields.importantPhrases !== undefined) {
		updates.push(`important_phrases = $${paramIdx++}`);
		values.push(fields.importantPhrases);
	}
	if (fields.variables !== undefined) {
		updates.push(`variables = $${paramIdx++}`);
		values.push(fields.variables);
	}
	if (updates.length === 0) return;

	values.push(id);
	const db = getDatabase();
	const whereClause = `id = $${paramIdx}`;
	await db.execute(`UPDATE messages SET ${updates.join(', ')} WHERE ${whereClause}`, values);
}
