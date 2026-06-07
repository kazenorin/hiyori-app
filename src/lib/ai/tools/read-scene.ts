import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import { getDatabase } from '$lib/db/database';
import { type ToolSet } from 'ai';
import type { ToolContext } from './tools';
import { log } from './utils';
import { traceActLineChain } from '$lib/db/acts';

interface SceneRow {
	role: string;
	content: string;
	scene_number: number | null;
}

async function querySceneMessages(actLineId: string, sceneNumber: number): Promise<SceneRow[]> {
	const db = getDatabase();
	return db.select<SceneRow[]>(
		`SELECT m.role, m.content, m.scene_number
		 FROM act_lines al
		 JOIN messages m ON al.message_id = m.id
		 WHERE al.act_line_id = $1 AND m.scene_number = $2
		 ORDER BY al.sequence`,
		[actLineId, sceneNumber]
	);
}

function formatSceneRows(rows: SceneRow[], sceneBodyHeader: string, playerResponseHeader: string): string | null {
	const assistantMsg = rows.find((r) => r.role === 'assistant');
	const userMsg = rows.find((r) => r.role === 'user');

	const parts: string[] = [];

	if (assistantMsg) {
		parts.push(`### ${sceneBodyHeader}\n\n${assistantMsg.content}`);
	}

	if (userMsg) {
		parts.push(`### ${playerResponseHeader}\n\n${userMsg.content}`);
	}

	if (parts.length === 0) return null;
	return parts.join('\n\n');
}

export function createReadSceneTool(ctx: ToolContext) {
	const { actLine } = ctx;

	const inputSchema = z.object({
		sceneNumber: z.number().int().min(1).describe(ls('tools.readScene.parameters.sceneNumber')),
	});

	return tool({
		description: ls('tools.readScene.description'),
		inputSchema,
		execute: async (input: z.infer<typeof inputSchema>): Promise<string> => {
			const { sceneNumber } = input;
			await log(`read-scene triggered: scene=${sceneNumber}, actLineId=${actLine.id}`);

			const rows = await querySceneMessages(actLine.id, sceneNumber);

			if (rows.length === 0) {
				return ls('tools.readScene.messages.noSceneFound', { sceneNumber });
			}

			const result = formatSceneRows(rows, ls('tools.readScene.headers.sceneBody'), ls('tools.readScene.headers.playerResponse'));
			if (!result) {
				return ls('tools.readScene.messages.sceneNoContent', { sceneNumber });
			}

			await log(`read-scene returned ${result.length} chars`);

			return result;
		},
	});
}

export function createReadDistantSceneTool(ctx: ToolContext) {
	const { actLine, act } = ctx;
	const currentActNumber = act.actNumber;

	const inputSchema = z.object({
		actNumber: z.number().int().min(1).describe(ls('tools.readDistantScene.parameters.actNumber')),
		sceneNumber: z.number().int().min(1).describe(ls('tools.readDistantScene.parameters.sceneNumber')),
	});

	return tool({
		description: ls('tools.readDistantScene.description', { currentActNumber }),
		inputSchema,
		execute: async (input: z.infer<typeof inputSchema>): Promise<string> => {
			const { actNumber, sceneNumber } = input;
			await log(`read-distant-scene triggered: act=${actNumber}, scene=${sceneNumber}, currentAct=${currentActNumber}`);

			if (actNumber > currentActNumber) {
				return ls('tools.readDistantScene.messages.futureAct');
			}

			const chain = await traceActLineChain(actLine.id);
			const entry = chain.find((e) => e.actNumber === actNumber);

			if (!entry) {
				return ls('tools.readDistantScene.messages.actNotInLineage', { actNumber });
			}

			const rows = await querySceneMessages(entry.actLineId, sceneNumber);

			if (rows.length === 0) {
				return ls('tools.readDistantScene.messages.noSceneFound', { actNumber, sceneNumber });
			}

			const result = formatSceneRows(
				rows,
				ls('tools.readDistantScene.headers.sceneBody'),
				ls('tools.readDistantScene.headers.playerResponse')
			);
			if (!result) {
				return ls('tools.readDistantScene.messages.sceneNoContent', { actNumber, sceneNumber });
			}

			await log(`read-distant-scene returned ${result.length} chars`);

			return result;
		},
	});
}

export function buildSceneTools(ctx: ToolContext, includeDistant = false): ToolSet {
	const tools: ToolSet = {
		'read-scene': createReadSceneTool(ctx),
	};

	if (includeDistant) {
		tools['read-distant-scene'] = createReadDistantSceneTool(ctx);
	}

	return tools;
}
