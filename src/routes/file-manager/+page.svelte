<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { TreeView, createTreeViewCollection, type TreeViewRootProps } from '@skeletonlabs/skeleton-svelte';
	import {
		readDirectoryNodes,
		readFileData,
		downloadFile,
		getLanguageFromPath,
		decodeText,
		saveFileContent,
		isFolderTypeProtected,
		isConfigUserModified,
		type FileNode,
		type FolderType,
	} from '$lib/fs/file-tree';
	import {
		type FileActionState,
		createFileActionState,
		handleExport as doHandleExport,
		handleDeleteFolder as doHandleDeleteFolder,
		handleCopyToStory as doHandleCopyToStory,
		handleRestoreDefault as doHandleRestoreDefault,
		handleDeleteFile as doHandleDeleteFile,
	} from '$lib/features/file-actions';
	import { getAllStoryFolderInfo, type StoryFolderInfo } from '$lib/db/story-folders';
	import { t } from '$lib/i18n';
	import { log } from '$lib/logging/logger';
	import { mobileFeatures } from '$lib/stores/mobile-nav.svelte';
	import CodeBlock from '$lib/components/CodeBlock.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import FolderIcon from '$lib/components/ui/FolderIcon.svelte';

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

	let actions = $state<FileActionState>(createFileActionState());
	let showDeleteConfirm = $state(false);

	let confirmDiscard = $state(false);

	let inlineCancelRef: HTMLButtonElement | null = $state(null);

	let isConfigModified = $state<boolean | null>(null);
	let stories = $state<StoryFolderInfo[]>([]);
	let selectedStoryFolder = $state<string>('');
	let showCopyPanel = $state(false);
	let showTreeOnMobile = $state(false);
	let showFileDeleteConfirm = $state(false);

	function focusInlineCancel() {
		if (inlineCancelRef) inlineCancelRef.focus();
	}

	$effect(() => {
		if (showDeleteConfirm || showFileDeleteConfirm) {
			tick().then(focusInlineCancel);
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
		actions.actionError = null;
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
		actions.actionError = null;
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

	function handleExport() {
		if (!selectedFilePath) return;
		doHandleExport(actions, selectedFilePath);
	}

	function handleDeleteFolder() {
		if (!selectedFilePath) return;
		doHandleDeleteFolder(actions, selectedFilePath, async () => {
			clearPreview();
			await loadRoot();
		});
	}

	function handleCopyToStory() {
		if (!selectedFilePath || !selectedStoryFolder) return;
		doHandleCopyToStory(actions, selectedFilePath, selectedStoryFolder, async () => {
			clearPreview();
			await loadRoot();
		});
	}

	function handleRestoreDefault() {
		if (!selectedFilePath) return;
		doHandleRestoreDefault(actions, selectedFilePath, { value: loadRequestId }, (content, binary, lang) => {
			isConfigModified = false;
			isBinary = binary;
			fileContent = content;
			fileLang = lang;
		});
	}

	function handleDeleteFile() {
		if (!selectedFilePath) return;
		doHandleDeleteFile(actions, selectedFilePath, async () => {
			clearPreview();
			await loadRoot();
		});
	}

	function openCopyPanel() {
		showCopyPanel = true;
		selectedStoryFolder = '';
		loadStories();
	}

	onMount(loadRoot);
</script>

<div class="flex h-full min-h-0 flex-col">
	<div class="flex items-center justify-between border-b border-surface-200-800 px-3 py-2 md:px-4">
		<h2 class="text-sm font-semibold text-surface-900-100">{t('fileManager.title')}</h2>
		<div class="flex items-center gap-2">
			<button
				class="btn preset-tonal p-1.5 text-surface-500 hover:text-surface-700-300 transition-colors md:hidden"
				type="button"
				onclick={() => (showTreeOnMobile = !showTreeOnMobile)}
				aria-label={t('fileManager.openFileList')}
			>
				<Icon name="menu" class="size-4" />
			</button>
			<button
				class="btn preset-tonal p-1.5 text-surface-500 hover:text-surface-700-300 transition-colors"
				type="button"
				onclick={loadRoot}
				disabled={isLoadingRoot}
				aria-label={t('fileManager.refresh')}
			>
				<Icon name="refresh-arrows" class="size-4 {isLoadingRoot ? 'animate-spin' : ''}" />
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
						<Spinner size="md" />
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
							<FolderIcon type={selectedNode.folderType ?? 'default'} />
						{/if}
						{selectedFilePath}
					</div>

					{#if selectedNode.isDirectory}
						{@render folderPreview()}
					{:else if isLoadingFile}
						<div class="flex items-center justify-center py-8">
							<Spinner size="md" class="border-3" />
						</div>
					{:else if fileError}
						<p class="text-error-500 text-sm">{fileError}</p>
					{:else if isBinary}
						<div class="flex items-center justify-center h-64">
							<div class="text-center space-y-3">
								<Icon name="download" class="size-8 mx-auto text-surface-500" />
								<p class="text-sm text-surface-600-400">{t('fileManager.binaryFile')}</p>
								<Button
									variant="filled"
									onclick={() => {
										if (selectedFilePath) downloadFile(selectedFilePath);
									}}
								>
									{t('fileManager.download')}
								</Button>
							</div>
						</div>
					{:else if isEditing}
						{@render editMode()}
					{:else if fileContent !== null}
						{@render filePreview()}
					{/if}
				{:else}
					<div class="flex flex-col items-center justify-center h-full gap-3 text-sm text-surface-600-400 text-center px-4">
						<Icon name="document" class="size-8" />
						<p>{t('fileManager.selectFile')}</p>
						{#if mobileFeatures.isPhone}
							<p class="text-xs">{t('fileManager.selectFileMobile')}</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#snippet folderPreview()}
	<div class="flex items-center justify-center h-64">
		<div class="text-center space-y-4">
			{#if isFolderProtected}
				<div class="flex items-center justify-center gap-2 text-sm text-surface-600-400">
					<Icon name="lock" class="size-4 text-warning-500" />
					{t('fileManager.protected')}
				</div>
			{/if}

			{#if showDeleteConfirm && !isFolderProtected}
				<p class="text-sm text-warning-500">{t('fileManager.deleteWarning')}</p>
			{/if}

			<div class="flex items-center justify-center gap-2">
				<button class="btn preset-tonal text-xs gap-1" type="button" onclick={handleExport} disabled={actions.isExporting}>
					<Icon name="download" class="size-3.5" />
					{actions.isExporting ? t('fileManager.exporting') : t('fileManager.export')}
				</button>
				{#if !isFolderProtected}
					{#if showDeleteConfirm}
						<button class="btn preset-filled-error text-xs gap-1" type="button" onclick={handleDeleteFolder} disabled={actions.isDeleting}>
							<Icon name="trash-can" class="size-3.5" />
							{actions.isDeleting ? '...' : t('fileManager.delete')}
						</button>
						<button
							bind:this={inlineCancelRef}
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
							<Icon name="trash-can" class="size-3.5" />
							{t('fileManager.delete')}
						</button>
					{/if}
				{/if}
			</div>

			{#if actions.actionError}
				<p class="text-xs text-error-500">{actions.actionError}</p>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet configActionBar()}
	{@const mc = selectedNode?.managedConfig}
	<div class="flex flex-wrap items-center gap-2 mb-2">
		{#if mc === 'managed'}
			<button class="btn preset-tonal text-xs" type="button" onclick={openCopyPanel} disabled={actions.isCopying}>
				<Icon name="copy-duplicate" class="size-3.5" />
				{t('fileManager.copyToStory')}
			</button>
			{#if isConfigModified}
				<button class="btn preset-tonal text-xs gap-1" type="button" onclick={handleRestoreDefault} disabled={actions.isRestoring}>
					<Icon name="refresh-arrows" class="size-3.5" />
					{actions.isRestoring ? t('fileManager.restoring') : t('fileManager.restoreDefault')}
				</button>
			{/if}
		{:else if mc === 'obsolete'}
			<p class="text-xs text-surface-600-400">{t('fileManager.obsoleteDescription')}</p>
			{#if showFileDeleteConfirm}
				<p class="text-xs text-warning-500">{t('fileManager.deleteFileWarning')}</p>
				<button class="btn preset-filled-error text-xs gap-1" type="button" onclick={handleDeleteFile} disabled={actions.isDeleting}>
					<Icon name="trash-can" class="size-3.5" />
					{actions.isDeleting ? '...' : t('fileManager.deleteObsolete')}
				</button>
				<button
					bind:this={inlineCancelRef}
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
					<Icon name="trash-can" class="size-3.5" />
					{t('fileManager.deleteObsolete')}
				</button>
			{/if}
		{/if}
		{#if mc === 'story-override'}
			<p class="text-xs text-surface-600-400">{t('fileManager.overrideDescription')}</p>
			{#if showFileDeleteConfirm}
				<p class="text-xs text-warning-500">{t('fileManager.deleteFileWarning')}</p>
				<button class="btn preset-filled-error text-xs gap-1" type="button" onclick={handleDeleteFile} disabled={actions.isDeleting}>
					<Icon name="trash-can" class="size-3.5" />
					{actions.isDeleting ? '...' : t('fileManager.deleteOverride')}
				</button>
				<button
					bind:this={inlineCancelRef}
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
					<Icon name="trash-can" class="size-3.5" />
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
					disabled={actions.isCopying || !selectedStoryFolder}
				>
					<Icon name="copy-duplicate" class="size-3.5" />
					{actions.isCopying ? t('fileManager.copying') : t('fileManager.copy')}
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
					<Icon name="pencil" class="size-3.5" />
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
			class="w-full h-[70dvh] rounded border border-surface-200-800 bg-surface-50-950 p-4 font-mono text-xs leading-relaxed text-surface-900-100 resize-y"
			bind:value={editContent}
		></textarea>
		{#if saveError}
			<p class="text-error-500 text-xs">{saveError}</p>
		{/if}
		<div class="sticky bottom-0 -mx-3 md:-mx-4 px-3 md:px-4 py-2 bg-surface-50-950 border-t border-surface-200-800">
			<div class="flex items-center gap-2">
				<button
					class="btn preset-filled text-xs gap-1"
					type="button"
					onclick={saveEditing}
					disabled={isSaving || editContent === fileContent}
				>
					<Icon name="check" class="size-3.5" />
					{isSaving ? t('fileManager.saving') : t('fileManager.save')}
				</button>
				<button class="btn preset-tonal text-xs" type="button" onclick={cancelEditing} disabled={isSaving}>
					{t('fileManager.cancel')}
				</button>
			</div>
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
						<Spinner size="xs" />
					</TreeView.BranchIndicator>
					<TreeView.BranchText>
						<FolderIcon type={node.folderType ?? 'default'} />
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
				<Icon name="document" class="size-4" />
				{node.name}
			</TreeView.Item>
		{/if}
	</TreeView.NodeProvider>
{/snippet}

<Modal bind:open={confirmDiscard} title={t('fileManager.edit')}>
	{#snippet body()}
		<p class="text-sm text-surface-600-400">
			{t('fileManager.unsavedChanges')}
		</p>
	{/snippet}
	{#snippet footer()}
		<div class="flex justify-end gap-3">
			<button
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
	{/snippet}
</Modal>
