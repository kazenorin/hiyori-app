<script lang="ts">
	import { onMount } from 'svelte';
	import { TreeView, createTreeViewCollection, type TreeViewRootProps } from '@skeletonlabs/skeleton-svelte';
	import {
		readDirectoryNodes,
		readFileData,
		downloadFile,
		getLanguageFromPath,
		decodeText,
		saveFileContent,
		exportFolderAsZip,
		deleteFolder,
		isFolderTypeProtected,
		copyConfigToStory,
		isConfigUserModified,
		restoreConfigDefault,
		deleteFile,
		type FileNode,
		type FolderType,
		type ManagedConfigKind,
	} from '$lib/fs/file-tree';
	import { getAllStoryFolderInfo, type StoryFolderInfo } from '$lib/db/story-folders';
	import { t } from '$lib/i18n';
	import { log } from '$lib/logging/logger';
	import CodeBlock from '$lib/components/CodeBlock.svelte';

	function createCollection(children: FileNode[] = []) {
		return createTreeViewCollection<FileNode>({
			nodeToValue: (node) => node.id,
			nodeToString: (node) => node.name,
			rootNode: { id: 'root', name: '', isDirectory: true, children },
		});
	}

	let collection = $state(createCollection());

	let selectedFilePath = $state<string | null>(null);
	let selectedNode = $state<FileNode | null>(null);
	let isFolderProtected = $state(false);
	let fileContent = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let isBinary = $state(false);
	let fileLang = $state('');
	let isLoadingFile = $state(false);
	let isLoadingRoot = $state(true);
	let rootError = $state<string | null>(null);
	let loadChildrenError = $state<string | null>(null);
	let loadRequestId = 0;

	let isEditing = $state(false);
	let editContent = $state('');
	let isSaving = $state(false);
	let saveError = $state<string | null>(null);

	let isExporting = $state(false);
	let showDeleteConfirm = $state(false);
	let isDeleting = $state(false);
	let isCopying = $state(false);
	let isRestoring = $state(false);
	let cancelButton: HTMLButtonElement | null = $state(null);

	let confirmDiscard = $state(false);
	let actionError = $state<string | null>(null);

	let isConfigModified = $state<boolean | null>(null);
	let stories = $state<StoryFolderInfo[]>([]);
	let selectedStoryFolder = $state<string>('');
	let showCopyPanel = $state(false);
	let showTreeOnMobile = $state(false);
	let showFileDeleteConfirm = $state(false);

	$effect(() => {
		if ((showDeleteConfirm || confirmDiscard || showFileDeleteConfirm) && cancelButton) {
			cancelButton.focus();
		}
	});

	async function loadRoot() {
		isLoadingRoot = true;
		rootError = null;
		loadChildrenError = null;
		try {
			const nodes = await readDirectoryNodes('');
			collection = createCollection(nodes);
		} catch (err) {
			rootError = err instanceof Error ? err.message : String(err);
			await log.error('file-manager', 'Failed to load root directory', err);
		} finally {
			isLoadingRoot = false;
		}
	}

	async function loadStories() {
		if (stories.length > 0) return;
		try {
			stories = await getAllStoryFolderInfo();
		} catch (err) {
			await log.error('file-manager', 'Failed to load stories', err);
		}
	}

	const loadChildren: TreeViewRootProps['loadChildren'] = async (details) => {
		return await readDirectoryNodes(details.node.id);
	};

	const onLoadChildrenComplete: TreeViewRootProps['onLoadChildrenComplete'] = (details) => {
		loadChildrenError = null;
		collection = details.collection;
	};

	const onLoadChildrenError: TreeViewRootProps['onLoadChildrenError'] = async (details) => {
		const failed = details.nodes.map((n) => n.node.name).join(', ');
		loadChildrenError = `Failed to load: ${failed}`;
		await log.error('file-manager', 'Failed to load children', details.nodes);
	};

	function clearPreview() {
		selectedFilePath = null;
		selectedNode = null;
		isFolderProtected = false;
		fileContent = null;
		fileError = null;
		isBinary = false;
		fileLang = '';
		isEditing = false;
		editContent = '';
		saveError = null;
		showDeleteConfirm = false;
		actionError = null;
		isConfigModified = null;
		showCopyPanel = false;
		selectedStoryFolder = '';
		showFileDeleteConfirm = false;
	}

	async function handleSelectionChange(details: { selectedValue: string[]; selectedNodes: FileNode[] }) {
		const node = details.selectedNodes[0];
		if (!node) {
			clearPreview();
			return;
		}

		selectedFilePath = node.id;
		selectedNode = node;
		isEditing = false;
		editContent = '';
		saveError = null;
		showDeleteConfirm = false;
		actionError = null;
		showCopyPanel = false;
		selectedStoryFolder = '';
		isConfigModified = null;
		showFileDeleteConfirm = false;

		if (node.isDirectory) {
			fileContent = null;
			fileError = null;
			isBinary = false;
			fileLang = '';
			isFolderProtected = isFolderTypeProtected(node.folderType);
			return;
		}

		isFolderProtected = false;
		const requestId = ++loadRequestId;
		fileLang = getLanguageFromPath(node.id);
		isLoadingFile = true;

		if (node.managedConfig === 'managed') {
			const modRequestId = requestId;
			isConfigUserModified(node.id).then((modified) => {
				if (modRequestId !== loadRequestId) return;
				isConfigModified = modified;
			});
		}

		try {
			const { data, isBinary: binary } = await readFileData(node.id);
			if (requestId !== loadRequestId) return;
			isBinary = binary;
			if (binary) {
				fileContent = null;
				fileError = null;
			} else {
				fileContent = decodeText(data);
				fileError = null;
			}
		} catch (err) {
			if (requestId !== loadRequestId) return;
			fileError = err instanceof Error ? err.message : String(err);
			fileContent = null;
			isBinary = false;
			fileLang = '';
		} finally {
			if (requestId === loadRequestId) {
				isLoadingFile = false;
			}
		}
	}

	function startEditing() {
		if (fileContent !== null) {
			editContent = fileContent;
			isEditing = true;
			saveError = null;
		}
	}

	function cancelEditing() {
		if (editContent !== fileContent) {
			confirmDiscard = true;
			return;
		}
		isEditing = false;
		editContent = '';
		saveError = null;
	}

	function confirmDiscardEdits() {
		confirmDiscard = false;
		isEditing = false;
		editContent = '';
		saveError = null;
	}

	async function saveEditing() {
		if (!selectedFilePath) return;
		const requestId = ++loadRequestId;
		isSaving = true;
		saveError = null;
		try {
			await saveFileContent(selectedFilePath, editContent);
			if (requestId !== loadRequestId) return;
			const { data, isBinary: binary } = await readFileData(selectedFilePath);
			if (requestId !== loadRequestId) return;
			isBinary = binary;
			fileContent = binary ? null : decodeText(data);
			fileLang = getLanguageFromPath(selectedFilePath);
			isEditing = false;
			editContent = '';
		} catch (err) {
			if (requestId !== loadRequestId) return;
			saveError = err instanceof Error ? err.message : String(err);
		} finally {
			if (requestId === loadRequestId) {
				isSaving = false;
			}
		}
	}

	async function handleExport() {
		if (!selectedFilePath) return;
		isExporting = true;
		actionError = null;
		try {
			await exportFolderAsZip(selectedFilePath);
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
			await log.error('file-manager', 'Failed to export folder', err);
		} finally {
			isExporting = false;
		}
	}

	async function handleDeleteFolder() {
		if (!selectedFilePath) return;
		isDeleting = true;
		actionError = null;
		try {
			await deleteFolder(selectedFilePath);
			clearPreview();
			await loadRoot();
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
			await log.error('file-manager', 'Failed to delete folder', err);
		} finally {
			isDeleting = false;
		}
	}

	async function handleCopyToStory() {
		if (!selectedFilePath || !selectedStoryFolder) return;
		isCopying = true;
		actionError = null;
		try {
			await copyConfigToStory(selectedFilePath, selectedStoryFolder);
			clearPreview();
			await loadRoot();
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
			await log.error('file-manager', 'Failed to copy to story', err);
		} finally {
			isCopying = false;
		}
	}

	async function handleRestoreDefault() {
		if (!selectedFilePath) return;
		isRestoring = true;
		actionError = null;
		try {
			await restoreConfigDefault(selectedFilePath);
			isConfigModified = false;
			const requestId = ++loadRequestId;
			const { data, isBinary: binary } = await readFileData(selectedFilePath);
			if (requestId !== loadRequestId) return;
			isBinary = binary;
			fileContent = binary ? null : decodeText(data);
			fileLang = getLanguageFromPath(selectedFilePath);
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
			await log.error('file-manager', 'Failed to restore default', err);
		} finally {
			isRestoring = false;
		}
	}

	async function handleDeleteFile() {
		if (!selectedFilePath) return;
		isDeleting = true;
		actionError = null;
		try {
			await deleteFile(selectedFilePath);
			clearPreview();
			await loadRoot();
		} catch (err) {
			actionError = err instanceof Error ? err.message : String(err);
			await log.error('file-manager', 'Failed to delete file', err);
		} finally {
			isDeleting = false;
		}
	}

	function openCopyPanel() {
		showCopyPanel = true;
		selectedStoryFolder = '';
		loadStories();
	}

	onMount(loadRoot);
</script>

<div class="flex h-full flex-col">
	<div class="flex items-center gap-2 p-3 border-b border-surface-200-800 shrink-0 md:hidden">
		<a href="/" class="text-sm font-medium text-surface-500 hover:text-surface-700-300 transition-colors flex items-center gap-1">
			<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
				<path
					fill-rule="evenodd"
					d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
					clip-rule="evenodd"
				/>
			</svg>
			{t('chat.back')}
		</a>
	</div>
	<div class="flex items-center justify-between border-b border-surface-200-800 px-3 py-2 md:px-4">
		<h2 class="text-sm font-semibold text-surface-900-100">{t('fileManager.title')}</h2>
		<div class="flex items-center gap-2">
			<button
				class="btn preset-tonal p-1.5 text-surface-500 hover:text-surface-700-300 transition-colors md:hidden"
				type="button"
				onclick={() => (showTreeOnMobile = !showTreeOnMobile)}
			>
				<svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
					><path stroke-linecap="round" stroke-linejoin="round" d="M3 7h18M3 12h18M3 17h18" /></svg
				>
			</button>
			<button
				class="btn preset-tonal p-1.5 text-surface-500 hover:text-surface-700-300 transition-colors"
				type="button"
				onclick={loadRoot}
				disabled={isLoadingRoot}
				aria-label={t('fileManager.refresh')}
			>
				<svg class="size-4 {isLoadingRoot ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
			</button>
		</div>
	</div>

	{#if loadChildrenError}
		<div class="px-4 py-2 bg-warning-500-900/10 border-b border-warning-500-900/30 text-xs text-warning-500">
			{loadChildrenError}
		</div>
	{/if}

	<div class="flex flex-1 overflow-hidden">
		{#if rootError}
			<div class="flex-1 flex items-center justify-center p-8">
				<div class="text-center space-y-2">
					<p class="text-error-500 text-sm">{rootError}</p>
					<button class="btn preset-tonal text-xs" type="button" onclick={loadRoot}>{t('fileManager.retry')}</button>
				</div>
			</div>
		{:else}
			<div
				class="shrink-0 border-r border-surface-200-800 overflow-y-auto relative {showTreeOnMobile ? 'block' : 'hidden md:block'} md:w-72"
			>
				{#if isLoadingRoot}
					<div class="flex items-center justify-center p-8">
						<div class="inline-block w-6 h-6 border-3 border-surface-200-800 border-t-primary-500 rounded-full animate-spin"></div>
					</div>
				{:else}
					<TreeView {collection} {loadChildren} {onLoadChildrenComplete} {onLoadChildrenError} onSelectionChange={handleSelectionChange}>
						<TreeView.Label>{t('fileManager.treeLabel')}</TreeView.Label>
						<TreeView.Tree>
							{#each collection.rootNode.children || [] as node, index (node)}
								{@render treeNode(node, [index])}
							{/each}
						</TreeView.Tree>
					</TreeView>
				{/if}
			</div>

			<div class="flex-1 overflow-auto p-3 md:p-4">
				{#if selectedFilePath && selectedNode}
					<div class="mb-3 flex items-center gap-2 text-xs font-medium text-surface-600-400 break-all">
						{#if selectedNode.isDirectory}
							{@render folderIcon(selectedNode.folderType ?? 'default', 'size-4')}
						{/if}
						{selectedFilePath}
					</div>

					{#if selectedNode.isDirectory}
						{@render folderPreview()}
					{:else if isLoadingFile}
						<div class="flex items-center justify-center py-8">
							<div class="inline-block w-5 h-5 border-3 border-surface-200-800 border-t-primary-500 rounded-full animate-spin"></div>
						</div>
					{:else if fileError}
						<p class="text-error-500 text-sm">{fileError}</p>
					{:else if isBinary}
						<div class="flex items-center justify-center h-64">
							<div class="text-center space-y-3">
								<svg class="size-8 mx-auto text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
								</svg>
								<p class="text-sm text-surface-600-400">{t('fileManager.binaryFile')}</p>
								<button
									class="btn preset-filled"
									type="button"
									onclick={() => {
										if (selectedFilePath) downloadFile(selectedFilePath);
									}}
								>
									{t('fileManager.download')}
								</button>
							</div>
						</div>
					{:else if isEditing}
						{@render editMode()}
					{:else if fileContent !== null}
						{@render filePreview()}
					{/if}
				{:else}
					<div class="flex items-center justify-center h-full text-sm text-surface-600-400">
						{t('fileManager.selectFile')}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#snippet folderIcon(type: FolderType, sizeClass: string = 'size-4')}
	{#if type === 'story'}
		<svg class={sizeClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
			/>
		</svg>
	{:else if type === 'config'}
		<svg class={sizeClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"
			/>
			<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
		</svg>
	{:else}
		<svg class={sizeClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
		</svg>
	{/if}
{/snippet}

{#snippet folderPreview()}
	<div class="flex items-center justify-center h-64">
		<div class="text-center space-y-4">
			{#if isFolderProtected}
				<div class="flex items-center justify-center gap-2 text-sm text-surface-600-400">
					<svg class="size-4 text-warning-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
						/>
					</svg>
					{t('fileManager.protected')}
				</div>
			{/if}

			{#if showDeleteConfirm && !isFolderProtected}
				<p class="text-sm text-warning-500">{t('fileManager.deleteWarning')}</p>
			{/if}

			<div class="flex items-center justify-center gap-2">
				<button class="btn preset-tonal text-xs gap-1" type="button" onclick={handleExport} disabled={isExporting}>
					<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
					</svg>
					{isExporting ? t('fileManager.exporting') : t('fileManager.export')}
				</button>
				{#if !isFolderProtected}
					{#if showDeleteConfirm}
						<button class="btn preset-filled-error text-xs gap-1" type="button" onclick={handleDeleteFolder} disabled={isDeleting}>
							<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
							{isDeleting ? '...' : t('fileManager.delete')}
						</button>
						<button
							bind:this={cancelButton}
							class="btn preset-tonal text-xs"
							type="button"
							onclick={() => {
								showDeleteConfirm = false;
							}}
						>
							{t('fileManager.cancel')}
						</button>
					{:else}
						<button
							class="btn preset-tonal text-xs gap-1"
							type="button"
							onclick={() => {
								showDeleteConfirm = true;
							}}
						>
							<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
							{t('fileManager.delete')}
						</button>
					{/if}
				{/if}
			</div>

			{#if actionError}
				<p class="text-xs text-error-500">{actionError}</p>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet configActionBar()}
	{@const mc = selectedNode?.managedConfig}
	<div class="flex flex-wrap items-center gap-2 mb-2">
		{#if mc === 'managed' || mc === 'obsolete'}
			{#if mc === 'managed'}
				<button class="btn preset-tonal text-xs" type="button" onclick={openCopyPanel} disabled={isCopying}>
					<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
						/>
					</svg>
					{t('fileManager.copyToStory')}
				</button>
				{#if isConfigModified}
					<button class="btn preset-tonal text-xs gap-1" type="button" onclick={handleRestoreDefault} disabled={isRestoring}>
						<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/>
						</svg>
						{isRestoring ? t('fileManager.restoring') : t('fileManager.restoreDefault')}
					</button>
				{/if}
			{/if}
			{#if mc === 'obsolete'}
				<p class="text-xs text-surface-600-400">{t('fileManager.obsoleteDescription')}</p>
				{#if showFileDeleteConfirm}
					<p class="text-xs text-warning-500">{t('fileManager.deleteFileWarning')}</p>
					<button class="btn preset-filled-error text-xs gap-1" type="button" onclick={handleDeleteFile} disabled={isDeleting}>
						<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
						{isDeleting ? '...' : t('fileManager.deleteObsolete')}
					</button>
					<button
						bind:this={cancelButton}
						class="btn preset-tonal text-xs"
						type="button"
						onclick={() => {
							showFileDeleteConfirm = false;
						}}
					>
						{t('fileManager.cancel')}
					</button>
				{:else}
					<button
						class="btn preset-filled-error text-xs gap-1"
						type="button"
						onclick={() => {
							showFileDeleteConfirm = true;
						}}
					>
						<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
						{t('fileManager.deleteObsolete')}
					</button>
				{/if}
			{/if}
		{/if}
		{#if mc === 'story-override'}
			<p class="text-xs text-surface-600-400">{t('fileManager.overrideDescription')}</p>
			{#if showFileDeleteConfirm}
				<p class="text-xs text-warning-500">{t('fileManager.deleteFileWarning')}</p>
				<button class="btn preset-filled-error text-xs gap-1" type="button" onclick={handleDeleteFile} disabled={isDeleting}>
					<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
					{isDeleting ? '...' : t('fileManager.deleteOverride')}
				</button>
				<button
					bind:this={cancelButton}
					class="btn preset-tonal text-xs"
					type="button"
					onclick={() => {
						showFileDeleteConfirm = false;
					}}
				>
					{t('fileManager.cancel')}
				</button>
			{:else}
				<button
					class="btn preset-filled-error text-xs gap-1"
					type="button"
					onclick={() => {
						showFileDeleteConfirm = true;
					}}
				>
					<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
					{t('fileManager.deleteOverride')}
				</button>
			{/if}
		{/if}
	</div>

	{#if showCopyPanel && mc === 'managed'}
		<div class="border border-surface-200-800 rounded-lg p-3 mb-2 space-y-2">
			<select
				class="w-full rounded border border-surface-200-800 bg-surface-50-950 px-3 py-1.5 text-xs text-surface-900-100"
				bind:value={selectedStoryFolder}
			>
				<option value="">{t('fileManager.selectStory')}</option>
				{#each stories as story}
					<option value={story.folderName}>{story.storyName}</option>
				{/each}
			</select>
			<div class="flex items-center gap-2">
				<button
					class="btn preset-filled text-xs gap-1"
					type="button"
					onclick={handleCopyToStory}
					disabled={isCopying || !selectedStoryFolder}
				>
					<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
						/>
					</svg>
					{isCopying ? t('fileManager.copying') : t('fileManager.copy')}
				</button>
				<button
					class="btn preset-tonal text-xs"
					type="button"
					onclick={() => {
						showCopyPanel = false;
					}}
				>
					{t('fileManager.cancel')}
				</button>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet filePreview()}
	<div class="space-y-2">
		{@render configActionBar()}
		<div class="flex justify-end gap-2">
			{#if fileLang && !isBinary && selectedNode?.managedConfig !== 'obsolete'}
				<button class="btn preset-tonal text-xs gap-1" type="button" onclick={startEditing}>
					<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
						/>
					</svg>
					{t('fileManager.edit')}
				</button>
			{/if}
		</div>
		<CodeBlock code={fileContent!} lang={fileLang || undefined} />
	</div>
{/snippet}

{#snippet editMode()}
	<div class="space-y-2">
		<textarea
			class="w-full h-[70vh] rounded border border-surface-200-800 bg-surface-50-950 p-4 font-mono text-xs leading-relaxed text-surface-900-100 resize-y"
			bind:value={editContent}
		></textarea>
		{#if saveError}
			<p class="text-error-500 text-xs">{saveError}</p>
		{/if}
		<div class="flex items-center gap-2">
			<button
				class="btn preset-filled text-xs gap-1"
				type="button"
				onclick={saveEditing}
				disabled={isSaving || editContent === fileContent}
			>
				<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				</svg>
				{isSaving ? t('fileManager.saving') : t('fileManager.save')}
			</button>
			<button class="btn preset-tonal text-xs" type="button" onclick={cancelEditing} disabled={isSaving}>
				{t('fileManager.cancel')}
			</button>
		</div>
	</div>
{/snippet}

{#snippet treeNode(node: FileNode, indexPath: number[])}
	<TreeView.NodeProvider value={{ node, indexPath }}>
		{#if node.isDirectory}
			<TreeView.Branch>
				<TreeView.BranchControl>
					<TreeView.BranchIndicator class="data-loading:hidden" />
					<TreeView.BranchIndicator class="hidden data-loading:inline">
						<div class="inline-block w-3 h-3 border-2 border-surface-200-800 border-t-primary-500 rounded-full animate-spin"></div>
					</TreeView.BranchIndicator>
					<TreeView.BranchText>
						{@render folderIcon(node.folderType ?? 'default')}
						{node.name}
					</TreeView.BranchText>
				</TreeView.BranchControl>
				<TreeView.BranchContent>
					<TreeView.BranchIndentGuide />
					{#each node.children ?? [] as childNode, childIndex (childNode)}
						{@render treeNode(childNode, [...indexPath, childIndex])}
					{/each}
				</TreeView.BranchContent>
			</TreeView.Branch>
		{:else}
			<TreeView.Item>
				<svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
					/>
				</svg>
				{node.name}
			</TreeView.Item>
		{/if}
	</TreeView.NodeProvider>
{/snippet}

{#if confirmDiscard}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		role="dialog"
		aria-modal="true"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		onclick={() => {
			confirmDiscard = false;
		}}
		onkeydown={(e) => e.key === 'Escape' && (confirmDiscard = false)}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<h3 class="text-lg font-semibold text-surface-900-100 mb-2">
				{t('fileManager.edit')}
			</h3>
			<p class="text-sm text-surface-600-400 mb-5">
				{t('fileManager.unsavedChanges')}
			</p>
			<div class="flex justify-end gap-3">
				<button
					bind:this={cancelButton}
					class="btn preset-tonal"
					type="button"
					onclick={() => {
						confirmDiscard = false;
					}}
				>
					{t('fileManager.cancel')}
				</button>
				<button
					class="bg-error-500 hover:bg-error-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
					type="button"
					onclick={confirmDiscardEdits}
				>
					{t('fileManager.discard')}
				</button>
			</div>
		</div>
	</div>
{/if}
