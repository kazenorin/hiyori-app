import { exportFolderAsZip, deleteFolder, copyConfigToStory, restoreConfigDefault, deleteFile } from '$lib/fs/file-tree';
import { readFileData, getLanguageFromPath, decodeText } from '$lib/fs/file-tree';
import { log } from '$lib/logging/logger';

export interface FileActionState {
	isExporting: boolean;
	isDeleting: boolean;
	isCopying: boolean;
	isRestoring: boolean;
	actionError: string | null;
}

export function createFileActionState(): FileActionState {
	return {
		isExporting: false,
		isDeleting: false,
		isCopying: false,
		isRestoring: false,
		actionError: null,
	};
}

export async function handleExport(state: FileActionState, selectedFilePath: string, _onComplete?: () => void): Promise<void> {
	state.isExporting = true;
	state.actionError = null;
	try {
		await exportFolderAsZip(selectedFilePath);
	} catch (err) {
		state.actionError = err instanceof Error ? err.message : String(err);
		await log.error('file-manager', 'Failed to export folder', err);
	} finally {
		state.isExporting = false;
	}
}

export async function handleDeleteFolder(state: FileActionState, selectedFilePath: string, onComplete: () => Promise<void>): Promise<void> {
	state.isDeleting = true;
	state.actionError = null;
	try {
		await deleteFolder(selectedFilePath);
		await onComplete();
	} catch (err) {
		state.actionError = err instanceof Error ? err.message : String(err);
		await log.error('file-manager', 'Failed to delete folder', err);
	} finally {
		state.isDeleting = false;
	}
}

export async function handleCopyToStory(
	state: FileActionState,
	selectedFilePath: string,
	selectedStoryFolder: string,
	onComplete: () => Promise<void>
): Promise<void> {
	state.isCopying = true;
	state.actionError = null;
	try {
		await copyConfigToStory(selectedFilePath, selectedStoryFolder);
		await onComplete();
	} catch (err) {
		state.actionError = err instanceof Error ? err.message : String(err);
		await log.error('file-manager', 'Failed to copy to story', err);
	} finally {
		state.isCopying = false;
	}
}

export async function handleRestoreDefault(
	state: FileActionState,
	selectedFilePath: string,
	loadRequestId: { value: number },
	onFileReload: (content: string | null, isBinary: boolean, fileLang: string) => void
): Promise<void> {
	state.isRestoring = true;
	state.actionError = null;
	try {
		await restoreConfigDefault(selectedFilePath);
		const requestId = ++loadRequestId.value;
		const { data, isBinary: binary } = await readFileData(selectedFilePath);
		if (requestId !== loadRequestId.value) return;
		const fileLang = getLanguageFromPath(selectedFilePath);
		onFileReload(binary ? null : decodeText(data), binary, fileLang);
	} catch (err) {
		state.actionError = err instanceof Error ? err.message : String(err);
		await log.error('file-manager', 'Failed to restore default', err);
	} finally {
		state.isRestoring = false;
	}
}

export async function handleDeleteFile(state: FileActionState, selectedFilePath: string, onComplete: () => Promise<void>): Promise<void> {
	state.isDeleting = true;
	state.actionError = null;
	try {
		await deleteFile(selectedFilePath);
		await onComplete();
	} catch (err) {
		state.actionError = err instanceof Error ? err.message : String(err);
		await log.error('file-manager', 'Failed to delete file', err);
	} finally {
		state.isDeleting = false;
	}
}
