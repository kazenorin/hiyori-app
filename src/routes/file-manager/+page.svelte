<script lang="ts">
	import { onMount } from 'svelte';
	import {
		TreeView,
		createTreeViewCollection,
		type TreeViewRootProps,
	} from '@skeletonlabs/skeleton-svelte';
	import {
		readDirectoryNodes,
		readFileData,
		downloadFile,
		getLanguageFromPath,
		decodeText,
		saveFileContent,
		exportFolderAsZip,
		isProtectedFolder,
		deleteFolder,
		type FileNode,
		type FolderType,
	} from '$lib/fs/file-tree';
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
	}

	async function handleSelectionChange(details: {
		selectedValue: string[];
		selectedNodes: FileNode[];
	}) {
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

		if (node.isDirectory) {
			fileContent = null;
			fileError = null;
			isBinary = false;
			fileLang = '';
			isFolderProtected = await isProtectedFolder(node.id);
			return;
		}

		isFolderProtected = false;
		const requestId = ++loadRequestId;
		fileLang = getLanguageFromPath(node.id);
		isLoadingFile = true;
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
			if (!confirm(t('fileManager.unsavedChanges'))) return;
		}
		isEditing = false;
		editContent = '';
		saveError = null;
	}

	async function saveEditing() {
		if (!selectedFilePath) return;
		isSaving = true;
		saveError = null;
		try {
			await saveFileContent(selectedFilePath, editContent);
			const { data, isBinary: binary } = await readFileData(selectedFilePath);
			isBinary = binary;
			fileContent = binary ? null : decodeText(data);
			fileLang = getLanguageFromPath(selectedFilePath);
			isEditing = false;
			editContent = '';
		} catch (err) {
			saveError = err instanceof Error ? err.message : String(err);
		} finally {
			isSaving = false;
		}
	}

	async function handleExport() {
		if (!selectedFilePath) return;
		isExporting = true;
		try {
			await exportFolderAsZip(selectedFilePath);
		} catch (err) {
			await log.error('file-manager', 'Failed to export folder', err);
		} finally {
			isExporting = false;
		}
	}

	async function handleDelete() {
		if (!selectedFilePath) return;
		isDeleting = true;
		try {
			await deleteFolder(selectedFilePath);
			clearPreview();
			await loadRoot();
		} catch (err) {
			await log.error('file-manager', 'Failed to delete folder', err);
		} finally {
			isDeleting = false;
		}
	}

	onMount(loadRoot);
</script>

<div class="flex h-full flex-col">
	<div class="flex items-center justify-between border-b border-surface-200-800 px-4 py-2">
		<h2 class="text-sm font-semibold text-surface-900-100">{t('fileManager.title')}</h2>
		<button
			class="btn preset-tonal p-1.5 text-surface-500 hover:text-surface-700-300 transition-colors"
			type="button"
			onclick={loadRoot}
			disabled={isLoadingRoot}
			aria-label={t('fileManager.refresh')}
		>
			<svg class="size-4 {isLoadingRoot ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
			</svg>
		</button>
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
			<div class="w-72 shrink-0 border-r border-surface-200-800 overflow-y-auto relative">
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

			<div class="flex-1 overflow-auto p-4">
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
									onclick={() => { if (selectedFilePath) downloadFile(selectedFilePath); }}
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
			<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
		</svg>
	{:else if type === 'config'}
		<svg class={sizeClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
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
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
					</svg>
					{t('fileManager.protected')}
				</div>
			{/if}

			{#if showDeleteConfirm && !isFolderProtected}
				<div class="space-y-3">
					<p class="text-sm text-warning-500">{t('fileManager.deleteWarning')}</p>
					<div class="flex items-center justify-center gap-2">
						<button
							class="btn preset-filled-error text-xs gap-1"
							type="button"
							onclick={handleDelete}
							disabled={isDeleting}
						>
							<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
							</svg>
							{isDeleting ? '...' : t('fileManager.delete')}
						</button>
						<button
							class="btn preset-tonal text-xs"
							type="button"
							onclick={() => { showDeleteConfirm = false; }}
						>
							{t('fileManager.cancel')}
						</button>
					</div>
				</div>
			{:else}
				<div class="flex items-center justify-center gap-2">
					<button
						class="btn preset-tonal text-xs gap-1"
						type="button"
						onclick={handleExport}
						disabled={isExporting}
					>
						<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
						</svg>
						{isExporting ? t('fileManager.exporting') : t('fileManager.export')}
					</button>
					{#if !isFolderProtected}
						<button
							class="btn preset-tonal text-xs gap-1"
							type="button"
							onclick={() => { showDeleteConfirm = true; }}
						>
							<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
							</svg>
							{t('fileManager.delete')}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet filePreview()}
	<div class="space-y-2">
		{#if fileLang && !isBinary}
			<div class="flex justify-end">
				<button
					class="btn preset-tonal text-xs gap-1"
					type="button"
					onclick={startEditing}
				>
					<svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
					</svg>
					{t('fileManager.edit')}
				</button>
			</div>
		{/if}
		<CodeBlock code={fileContent!} lang={fileLang || undefined} />
	</div>
{/snippet}

{#snippet editMode()}
	<div class="space-y-2">
		<textarea
			class="w-full h-96 rounded border border-surface-200-800 bg-surface-50-950 p-3 font-mono text-sm text-surface-900-100 resize-y"
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
			<button
				class="btn preset-tonal text-xs"
				type="button"
				onclick={cancelEditing}
				disabled={isSaving}
			>
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
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
				{node.name}
			</TreeView.Item>
		{/if}
	</TreeView.NodeProvider>
{/snippet}
