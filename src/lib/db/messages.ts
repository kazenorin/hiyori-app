import { getDatabase } from './database';
import { type NarrativeSections, emptySections, NARRATIVE_SECTION_FIELDS } from '$lib/ai/parser-chain';

export interface GameData {
	worldState: string;
	decisions: string[];
	playerAliases?: string[];
	aliases?: string[][];
}

export interface MessageBase {
	role: 'user' | 'assistant';
	content: string;
}

export interface Message extends MessageBase {
	id: string;
	reasoning?: string;
	metadata?: string;
	gameData?: GameData;
	sceneNumber?: number;
	sessionNumber?: number;
	sections?: NarrativeSections;
	createdAt: number;
}

interface MessageRow {
	id: string;
	role: string;
	content: string;
	reasoning: string | null;
	metadata: string | null;
	game_data: string | null;
	scene_number: number | null;
	session_number: number | null;
	sections: string | null;
	created_at: number;
}

export function parseGameData(raw: string | null): GameData | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			typeof parsed.worldState === 'string' &&
			Array.isArray(parsed.decisions) &&
			parsed.decisions.every((d: unknown) => typeof d === 'string')
		) {
			const result: GameData = { worldState: parsed.worldState, decisions: parsed.decisions };
			if (Array.isArray(parsed.playerAliases) && parsed.playerAliases.every((d: unknown) => typeof d === 'string')) {
				result.playerAliases = parsed.playerAliases;
			}
			if (
				Array.isArray(parsed.aliases) &&
				parsed.aliases.every((a: unknown) => Array.isArray(a) && (a as unknown[]).every((d: unknown) => typeof d === 'string'))
			) {
				result.aliases = parsed.aliases;
			}
			return result;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function rowToMessage(row: MessageRow): Message {
	return {
		id: row.id,
		role: row.role as 'user' | 'assistant',
		content: row.content,
		reasoning: row.reasoning ?? undefined,
		metadata: row.metadata ?? undefined,
		gameData: parseGameData(row.game_data),
		sceneNumber: row.scene_number ?? undefined,
		sessionNumber: row.session_number ?? undefined,
		sections: parseSections(row.sections),
		createdAt: row.created_at,
	};
}

function parseSections(raw: string | null): NarrativeSections | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			return undefined;
		}
		const result = emptySections();
		for (const field of NARRATIVE_SECTION_FIELDS) {
			const value = parsed[field];
			if (typeof value === 'string') {
				result[field] = value;
			}
		}
		return result;
	} catch {
		return undefined;
	}
}

export async function createMessage(message: Omit<Message, 'createdAt'>): Promise<Message> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute(
		`INSERT INTO messages (id, role, content, reasoning, metadata, game_data, scene_number, session_number, sections, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[
			message.id,
			message.role,
			message.content,
			message.reasoning ?? null,
			message.metadata ?? null,
			message.gameData ? JSON.stringify(message.gameData) : null,
			message.sceneNumber ?? null,
			message.sessionNumber ?? null,
			message.sections ? JSON.stringify(message.sections) : null,
			now,
		]
	);
	return { ...message, createdAt: now };
}

export async function getMessage(id: string): Promise<Message | null> {
	const db = getDatabase();
	const rows = await db.select<MessageRow[]>('SELECT * FROM messages WHERE id = $1', [id]);
	return rows.length > 0 ? rowToMessage(rows[0]) : null;
}

export async function deleteMessage(id: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM messages WHERE id = $1', [id]);
}
