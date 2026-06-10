import JSZip from 'jszip';
import type { StoryExportData } from '$lib/features/story-export-load/archive-schema';
import type { LoadMode } from '$lib/features/story-export-load/story-loader';
import { validateArchive } from '$lib/features/story-export-load/archive-validator';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

export interface ActLineSelection {
	id: string;
	actId: string;
	actName: string;
	actNumber: number;
	name: string;
	isMainLine: boolean;
	plotMode: string;
	continuedFrom: string | null;
	sceneCount: number | null;
	actConcluded: boolean;
	included: boolean;
	required: boolean;
}

type LoadPhase = 'select' | 'validating' | 'configuring' | 'loading' | 'complete' | 'error';

class LoadStoryState {
	phase = $state<LoadPhase>('select');
	zip = $state<JSZip | null>(null);
	data = $state<StoryExportData | null>(null);
	actLines = $state<ActLineSelection[]>([]);
	loadMode = $state<LoadMode>('overwrite');
	errorMessage = $state<string | null>(null);
	warnings = $state<string[]>([]);
	isLoading = $state(false);

	get canLoad(): boolean {
		return this.actLines.some((l) => l.included) && !this.isLoading;
	}

	reset(): void {
		this.phase = 'select';
		this.zip = null;
		this.data = null;
		this.actLines = [];
		this.loadMode = 'overwrite';
		this.errorMessage = null;
		this.warnings = [];
		this.isLoading = false;
	}

	async handleFile(file: File): Promise<void> {
		this.phase = 'validating';
		this.errorMessage = null;
		this.warnings = [];

		try {
			const loadedZip = await JSZip.loadAsync(file);

			const result = await validateArchive(loadedZip);
			if (!result.isValid) {
				this.errorMessage = result.errors.join('\n');
				this.phase = 'error';
				return;
			}

			if (!result.data) {
				this.errorMessage = 'Failed to parse archive data';
				this.phase = 'error';
				return;
			}

			this.zip = loadedZip;
			this.data = result.data;
			this.warnings = result.warnings;

			this.actLines = this.buildActLineSelections(result.data);

			this.phase = 'configuring';
		} catch (err) {
			this.errorMessage = err instanceof Error ? err.message : 'Failed to read archive';
			this.phase = 'error';
		}
	}

	private buildActLineSelections(data: StoryExportData): ActLineSelection[] {
		const actMap = new SvelteMap<string, (typeof data.acts)[number]>(data.acts.map((a) => [a.id, a]));
		const eventMap = new SvelteMap<string, boolean>();

		for (const evt of data.actLineEvents) {
			if (evt.event === 'ending') {
				eventMap.set(evt.actLineId, true);
			}
		}

		const lines: ActLineSelection[] = [];

		for (const meta of data.actLineMeta) {
			const act = actMap.get(meta.actId);
			const continuedFrom = act?.continuesFromActLineId ?? null;

			let sceneCount: number | null = null;
			const entries = data.actLineEntries.filter((e) => e.actLineId === meta.id);
			if (entries.length > 0) {
				const sortedEntries = [...entries].sort((a, b) => b.sequence - a.sequence);
				const lastEntry = sortedEntries[0];
				const msgs = data.messages.filter((m) => m.id === lastEntry.messageId);
				if (msgs.length > 0 && msgs[0].sceneNumber != null) {
					sceneCount = msgs[0].sceneNumber;
				} else {
					sceneCount = entries.length;
				}
			}

			lines.push({
				id: meta.id,
				actId: meta.actId,
				actName: act?.name ?? 'Unknown Act',
				actNumber: act?.actNumber ?? 0,
				name: meta.name,
				isMainLine: meta.isMainLine,
				plotMode: meta.plotMode,
				continuedFrom,
				sceneCount,
				actConcluded: eventMap.get(meta.id) ?? false,
				included: true,
				required: false,
			});
		}

		this.enforceLineage(lines, data);

		return lines;
	}

	private enforceLineage(lines: ActLineSelection[], data: StoryExportData): void {
		for (const line of lines) {
			line.required = false;
		}

		const actMap = new Map<string, (typeof data.acts)[number]>(data.acts.map((a) => [a.id, a]));
		const actLineMap = new Map<string, ActLineSelection>(lines.map((l) => [l.id, l]));

		for (const line of lines) {
			if (!line.included) continue;
			const act = actMap.get(line.actId);
			if (!act?.continuesFromActLineId) continue;

			let currentId: string | null = act.continuesFromActLineId;
			const visited = new SvelteSet<string>();
			while (currentId && !visited.has(currentId)) {
				visited.add(currentId);
				const parentLine = actLineMap.get(currentId);
				if (parentLine) {
					parentLine.required = true;
					parentLine.included = true;
				}
				const parentAct = parentLine ? actMap.get(parentLine.actId) : null;
				currentId = parentAct?.continuesFromActLineId ?? null;
			}
		}
	}

	toggleLine(id: string): void {
		const line = this.actLines.find((l) => l.id === id);
		if (!line) return;

		const newIncluded = !line.included;

		if (newIncluded) {
			line.included = true;
			this.enforceLineage(this.actLines, this.data!);
		} else {
			const wouldBreak = this.actLines.some((l) => l.included && l.id !== id && l.continuedFrom === id);
			if (wouldBreak) {
				return;
			}
			line.included = false;
			line.required = false;
			this.enforceLineage(this.actLines, this.data!);
		}
	}
}

export function getLoadStoryStore(): LoadStoryState {
	return new LoadStoryState();
}
