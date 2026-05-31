<script lang="ts">
	import { onMount } from 'svelte';
	import {
		TreeView,
		createTreeViewCollection,
		type TreeViewRootProps,
	} from '@skeletonlabs/skeleton-svelte';
	import {
		readDirectoryNodes,
		readFileContent,
		isBinaryFile,
		downloadFile,
		type FileNode,
	} from '$lib/fs/file-tree';
	import { t } from '$lib/i18n';
	import { log } from '$lib/logging/logger';

	function createCollection(children: FileNode[] = []) {
		return createTreeViewCollection<FileNode>({
			nodeToValue: (node) => node.id,
			nodeToString: (node) => node.name,
			rootNode: { id: 'root', name: '', isDirectory: true, children },
		});
	}

	let collection = $state(createCollection());

	let selectedFilePath = $state<string | null>(null);
	let fileContent = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let isBinary = $state(false);
	let isLoadingFile = $state(false);
	let isLoadingRoot = $state(true);
	let rootError = $state<string | null>(null);
	let loadChildrenError = $state<string | null>(null);
	let loadRequestId = 0;

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
		fileContent = null;
		fileError = null;
		isBinary = false;
	}

	async function handleSelectionChange(details: {
		selectedValue: string[];
		selectedNodes: FileNode[];
	}) {
		const node = details.selectedNodes[0];
		if (!node || node.isDirectory) {
			clearPreview();
			return;
		}

		const requestId = ++loadRequestId;
		selectedFilePath = node.id;
		isLoadingFile = true;
		try {
			const binary = await isBinaryFile(node.id);
			if (requestId !== loadRequestId) return;
			isBinary = binary;
			if (binary) {
				fileContent = null;
				fileError = null;
			} else {
				const content = await readFileContent(node.id);
				if (requestId !== loadRequestId) return;
				fileContent = content;
				fileError = null;
			}
		} catch (err) {
			if (requestId !== loadRequestId) return;
			fileError = err instanceof Error ? err.message : String(err);
			fileContent = null;
			isBinary = false;
		} finally {
			if (requestId === loadRequestId) {
				isLoadingFile = false;
			}
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
				{#if selectedFilePath}
					<div class="mb-2 text-xs font-medium text-surface-600-400 break-all">{selectedFilePath}</div>
					{#if isLoadingFile}
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
									onclick={() => downloadFile(selectedFilePath!)}
								>
									{t('fileManager.download')}
								</button>
							</div>
						</div>
					{:else if fileContent !== null}
						<pre class="text-xs whitespace-pre-wrap break-words font-mono text-surface-800-200 leading-relaxed">{fileContent}</pre>
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
						<svg class="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
						</svg>
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
