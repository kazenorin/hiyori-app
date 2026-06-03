import {
	downloadExport,
	exportConfigData,
	exportGameData,
	importConfigData,
	importGameData,
	readFileAsUint8Array,
} from '$lib/db/data-portability';
import { t } from '$lib/i18n';

export interface DataImportExportState {
	isExporting: boolean;
	isImporting: boolean;
	importError: string | null;
	showImportConfirm: boolean;
	pendingImportFile: File | null;
}

export function createDataImportExportState(): DataImportExportState {
	return {
		isExporting: false,
		isImporting: false,
		importError: null,
		showImportConfirm: false,
		pendingImportFile: null,
	};
}

export async function handleExport<T>(
	state: DataImportExportState,
	exporter: (onProgress: (pct: number) => void) => Promise<T>,
	filename: string,
	exportProgressSetter: (v: number | null) => void
): Promise<void> {
	state.isExporting = true;
	state.importError = null;
	exportProgressSetter(0);
	try {
		const data = await exporter((percent: number) => exportProgressSetter(Math.round(percent)));
		const ts = new Date().toISOString().slice(0, 10);
		await downloadExport(data as Parameters<typeof downloadExport>[0], `${filename}-${ts}.zip`);
	} catch (err) {
		state.importError = t('settings.exportFailed', { error: err instanceof Error ? err.message : String(err) });
	} finally {
		state.isExporting = false;
		exportProgressSetter(null);
	}
}

export function handleImportFileSelect(state: DataImportExportState, e: Event): void {
	const file = (e.currentTarget as HTMLInputElement).files?.[0];
	if (!file) return;
	state.pendingImportFile = file;
	state.showImportConfirm = true;
	(e.currentTarget as HTMLInputElement).value = '';
}

export function handleImportCancel(state: DataImportExportState): void {
	state.showImportConfirm = false;
	state.pendingImportFile = null;
}

export async function handleImportConfirm<T>(
	state: DataImportExportState,
	importer: (data: Uint8Array) => Promise<T>,
	isImportingGlobalSetter: (v: boolean) => void
): Promise<void> {
	state.showImportConfirm = false;
	if (!state.pendingImportFile) return;
	state.isImporting = true;
	isImportingGlobalSetter(true);
	state.importError = null;
	try {
		const data = await readFileAsUint8Array(state.pendingImportFile);
		await importer(data);
		window.location.reload();
	} catch (err) {
		state.importError = t('settings.importFailed', { error: err instanceof Error ? err.message : String(err) });
		state.isImporting = false;
		isImportingGlobalSetter(false);
	} finally {
		state.pendingImportFile = null;
	}
}
