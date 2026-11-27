import { writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { providers, generatedAt } from '@opencode-ai/models/snapshot';

const SUPPORTED_NPM = new Set(['@ai-sdk/openai-compatible', '@ai-sdk/openai', '@openrouter/ai-sdk-provider']);
const OUT = join(import.meta.dirname, '..', 'src', 'lib', 'ai', 'catalog', 'snapshot.json');

const result = [];
let modelCount = 0;

for (const p of Object.values(providers)) {
	if (!SUPPORTED_NPM.has(p.npm)) continue;
	const models = [];
	for (const m of Object.values(p.models)) {
		if (m.type !== undefined && m.type !== 'chat') continue;
		const effectiveNpm = m.provider?.npm ?? p.npm;
		if (!SUPPORTED_NPM.has(effectiveNpm)) continue;
		models.push({
			id: m.id,
			name: m.name,
			reasoning: m.reasoning,
			tool_call: m.tool_call,
			attachment: m.attachment,
			...(m.status ? { status: m.status } : {}),
			release_date: m.release_date,
			context: m.limit.context,
			...(m.reasoning_options ? { reasoning_options: m.reasoning_options } : {}),
			...(m.temperature !== undefined ? { temperature: m.temperature } : {}),
			...(m.provider ? { provider: m.provider } : {}),
		});
	}
	if (models.length === 0) continue;
	models.sort((a, b) => a.name.localeCompare(b.name));
	modelCount += models.filter((m) => m.status !== 'deprecated').length;
	result.push({ id: p.id, name: p.name, npm: p.npm, ...(p.api ? { api: p.api } : {}), env: p.env, doc: p.doc, models });
}

result.sort((a, b) => a.name.localeCompare(b.name));
const json = JSON.stringify({ generatedAt, providers: result }, null, '\t');
writeFileSync(OUT, json);
const raw = statSync(OUT).size;
const gz = gzipSync(json).length;
console.log(
	`Snapshot: ${result.length} providers, ${modelCount} current models, ${(raw / 1024).toFixed(0)}KB raw, ${(gz / 1024).toFixed(0)}KB gzip → ${OUT}`
);
