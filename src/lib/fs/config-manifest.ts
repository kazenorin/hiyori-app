import { fs } from '$lib/fs/file-system';
import { log } from '$lib/logging/logger';
import yaml from 'js-yaml';
import rawManifest from './config-assets-manifest.yaml?raw';

export interface ConfigAssetEntry {
	configPath: string;
	hash: string | null;
	oldHashes: string[];
	updatedAt: string;
}

function flattenManifestTree(node: unknown): ConfigAssetEntry[] {
	const entries: ConfigAssetEntry[] = [];

	function walk(current: unknown): void {
		if (current == null || typeof current !== 'object') return;
		const obj = current as Record<string, unknown>;
		if (typeof obj.configPath === 'string') {
			entries.push({
				configPath: obj.configPath,
				hash: typeof obj.hash === 'string' ? obj.hash : null,
				oldHashes: Array.isArray(obj.oldHashes)
					? (obj.oldHashes as string[]).filter((h): h is string => typeof h === 'string')
					: [],
				updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '',
			});
			return;
		}
		for (const value of Object.values(obj)) {
			walk(value);
		}
	}

	walk(node);
	return entries;
}

export function loadManifest(): Map<string, ConfigAssetEntry> {
	const parsed = yaml.load(rawManifest);
	const entries = flattenManifestTree(parsed);
	const map = new Map<string, ConfigAssetEntry>();
	for (const entry of entries) {
		map.set(entry.configPath, entry);
	}
	return map;
}

async function hashFileContent(content: string): Promise<string> {
	const normalized = content.replaceAll('\r\n', '\n');
	const encoder = new TextEncoder();
	const data = encoder.encode(normalized);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const bundledContentMap = new Map<string, string>();

export function registerBundledContent(configPath: string, content: string): void {
	bundledContentMap.set(configPath, content);
}

export function getBundledContent(configPath: string): string | undefined {
	return bundledContentMap.get(configPath);
}

export async function syncConfigAssets(): Promise<void> {
	const manifest = loadManifest();
	let updated = false;

	for (const [configPath, entry] of manifest) {
		const fullPath = `config/${configPath}`;
		const fileExists = await fs.exists(fullPath);

		if (!fileExists) continue;

		const diskContent = await fs.readTextFile(fullPath);
		const diskHash = await hashFileContent(diskContent);
		const knownHashes = [...entry.oldHashes, entry.hash].filter((h): h is string => h !== null);
		const isUserEdited = !knownHashes.includes(diskHash);

		if (entry.hash === null) {
			if (!isUserEdited) {
				await fs.remove(fullPath);
				updated = true;
				await log.info('config-sync', `Removed obsolete config file: ${configPath}`);
			} else {
				await log.info('config-sync', `Kept user-edited removed file: ${configPath}`);
			}
			continue;
		}

		if (isUserEdited) {
			await log.info('config-sync', `Skipping user-edited file: ${configPath}`);
			continue;
		}

		if (diskHash !== entry.hash) {
			const content = bundledContentMap.get(configPath);
			if (content !== undefined) {
				await fs.writeTextFileEnsuringDir(fullPath, content);
				updated = true;
			}
		}
	}

	if (updated) {
		await log.info('config-sync', 'Config assets synchronized.');
	}
}
