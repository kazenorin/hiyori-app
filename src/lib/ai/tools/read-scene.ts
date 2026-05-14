import { ls } from '$lib/definitions/locale-strings';
import { tool } from 'ai';
import { z } from 'zod';
import { getDatabase } from '$lib/db/database';
import { type ToolSet } from 'ai';
import type { ToolContext } from './tools';
import { fileLog, log } from '$lib/logging/logger';

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
			const logMessage = `read-scene triggered: scene=${sceneNumber}, actLineId=${actLine.id}`;
			await log.debug('tool', logMessage);
			await fileLog('debug', 'tool', logMessage);

			const rows = await querySceneMessages(actLine.id, sceneNumber);

			if (rows.length === 0) {
				return ls('tools.readScene.messages.noSceneFound', { sceneNumber });
			}

			const assistantMsg = rows.find((r) => r.role === 'assistant');
			const userMsg = rows.find((r) => r.role === 'user');

			const parts: string[] = [];

			if (assistantMsg) {
				parts.push(`### ${ls('tools.readScene.headers.sceneBody')}\n\n${assistantMsg.content}`);
			}

			if (userMsg) {
				parts.push(`### ${ls('tools.readScene.headers.playerResponse')}\n\n${userMsg.content}`);
			}

			if (parts.length === 0) {
				return ls('tools.readScene.messages.sceneNoContent', { sceneNumber });
			}

			const result = parts.join('\n\n');
			const endLogMessage = `read-scene returned ${result.length} chars`;
			await log.debug('tool', endLogMessage);
			await fileLog('debug', 'tool', endLogMessage);

			return result;
		},
	});
}

export function buildSceneTools(ctx: ToolContext): ToolSet {
	return {
		'read-scene': createReadSceneTool(ctx),
	};
}
