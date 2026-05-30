import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

const LOCALES = ['en', 'zh-Hant-HK'];
const SRC_ROOT = join(import.meta.dirname, '..', 'src', 'lib', 'fs');
const MANIFEST_PATH = join(SRC_ROOT, 'config-assets-manifest.yaml');

function hashFile(filePath) {
	const content = readFileSync(filePath, 'utf-8').replaceAll('\r\n', '\n');
	return createHash('sha256').update(content).digest('hex');
}

function walkDir(dir) {
	const results = [];
	if (!existsSync(dir)) return results;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkDir(fullPath));
		} else {
			results.push(fullPath);
		}
	}
	return results;
}

function setNestedValue(obj, keys, value) {
	let current = obj;
	for (let i = 0; i < keys.length - 1; i++) {
		if (!(keys[i] in current)) {
			current[keys[i]] = {};
		}
		current = current[keys[i]];
	}
	current[keys[keys.length - 1]] = value;
}

function pathToTreeKeys(locale, subDir, relativePath) {
	const parts = [locale, subDir];
	const dirParts = relativePath.includes('/') ? relativePath.split('/').slice(0, -1) : [];
	const fileName = relativePath.split('/').pop();
	parts.push(...dirParts, fileName);
	return parts;
}

function localeStringTreeKeys(locale) {
	return ['locale-strings', `${locale}.yaml`];
}

function collectSourceFiles() {
	const entries = [];

	for (const locale of LOCALES) {
		const promptsDir = join(SRC_ROOT, locale, 'prompts');
		for (const filePath of walkDir(promptsDir)) {
			const relFromPrompts = relative(promptsDir, filePath).split(sep).join('/');
			const configPath = `${locale}/prompt-templates/${relFromPrompts}`;
			const treeKeys = pathToTreeKeys(locale, 'prompts', relFromPrompts);
			entries.push({ filePath, configPath, treeKeys });
		}

		const viewTemplatesDir = join(SRC_ROOT, locale, 'view-templates');
		for (const filePath of walkDir(viewTemplatesDir)) {
			const relFromViewTemplates = relative(viewTemplatesDir, filePath).split(sep).join('/');
			const configPath = `${locale}/view-templates/${relFromViewTemplates}`;
			const treeKeys = pathToTreeKeys(locale, 'view-templates', relFromViewTemplates);
			entries.push({ filePath, configPath, treeKeys });
		}
	}

	const localeStringsDir = join(SRC_ROOT, 'locale-strings');
	for (const locale of LOCALES) {
		const filePath = join(localeStringsDir, `${locale}.yaml`);
		if (existsSync(filePath)) {
			const configPath = `${locale}/locale-strings.yaml`;
			const treeKeys = localeStringTreeKeys(locale);
			entries.push({ filePath, configPath, treeKeys });
		}
	}

	return entries;
}

function flattenManifestToEntries(tree) {
	const entries = [];

	function walk(node, keys) {
		if (node == null || typeof node !== 'object') return;
		if (typeof node.configPath === 'string') {
			entries.push({ keys, entry: node });
			return;
		}
		for (const [key, value] of Object.entries(node)) {
			walk(value, [...keys, key]);
		}
	}

	walk(tree, []);
	return entries;
}

function main() {
	if (!existsSync(MANIFEST_PATH)) {
		writeFileSync(MANIFEST_PATH, 'src:\n  lib:\n    fs: {}\n', 'utf-8');
	}

	let manifest;
	try {
		const content = readFileSync(MANIFEST_PATH, 'utf-8');
		manifest = yaml.load(content) || {};
	} catch {
		manifest = {};
	}

	if (!manifest.src) manifest.src = {};
	if (!manifest.src.lib) manifest.src.lib = {};
	if (!manifest.src.lib.fs) manifest.src.lib.fs = {};

	const fsTree = manifest.src.lib.fs;
	const existingEntries = flattenManifestToEntries(fsTree);
	const existingByKey = new Map();
	for (const { keys, entry } of existingEntries) {
		existingByKey.set(keys.join('\0'), entry);
	}

	const sourceFiles = collectSourceFiles();
	const now = new Date().toISOString();
	const seenKeys = new Set();
	let changed = false;

	for (const { filePath, configPath, treeKeys } of sourceFiles) {
		const key = treeKeys.join('\0');
		seenKeys.add(key);

		const newHash = hashFile(filePath);
		const existing = existingByKey.get(key);

		if (!existing) {
			setNestedValue(fsTree, treeKeys, {
				configPath,
				hash: newHash,
				oldHashes: [],
				updatedAt: now,
			});
			changed = true;
			continue;
		}

		if (existing.hash === newHash) continue;

		if (existing.hash !== null) {
			existing.oldHashes.unshift(existing.hash);
		}
		existing.hash = newHash;
		existing.updatedAt = now;
		changed = true;
	}

	for (const [key, entry] of existingByKey) {
		if (seenKeys.has(key)) continue;
		if (entry.hash === null) continue;

		entry.oldHashes.unshift(entry.hash);
		entry.hash = null;
		entry.updatedAt = now;
		changed = true;
	}

	if (changed) {
		const output = yaml.dump(manifest, {
			quotingType: '"',
			forceQuotes: false,
			lineWidth: -1,
			noCompatMode: true,
			sortKeys: false,
		});
		writeFileSync(MANIFEST_PATH, output, 'utf-8');
		console.log(`Manifest updated: ${MANIFEST_PATH}`);
	} else {
		console.log('Manifest up to date, no changes.');
	}
}

main();
