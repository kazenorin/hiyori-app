<script lang="ts">
	import { t } from '$lib/i18n';
	import { settings, updateSettings, type Settings } from '$lib/stores/settings.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import { isTauriSync } from '$lib/runtime';
	import { getUrlWarnings } from '$lib/utils/url-security';
	import { getAllStories, type Story } from '$lib/db/stories';
	import {
		getCloudSyncStatus,
		getCloudSyncError,
		getLastSyncReport,
		getLastSyncedAt,
		refreshCloudSyncStatus,
		testCloudSyncConnection,
		runCloudSync,
	} from '$lib/features/cloud-sync/cloud-sync.svelte';

	type CloudSyncSettings = NonNullable<Settings['cloudSync']>;

	const EMPTY_S3 = { endpoint: '', region: 'auto', bucket: '', prefix: '', accessKeyId: '', secretAccessKey: '' };
	const EMPTY_WEBDAV = { url: '', username: '', password: '' };

	function currentSync(): CloudSyncSettings {
		return settings.cloudSync ?? { enabled: false, backend: 's3', s3: { ...EMPTY_S3 }, webdav: { ...EMPTY_WEBDAV } };
	}

	function updateSync(patch: Partial<CloudSyncSettings>): void {
		updateSettings({ cloudSync: { ...currentSync(), ...patch } });
	}

	function updateS3(patch: Partial<CloudSyncSettings['s3']>): void {
		updateSync({ s3: { ...(currentSync().s3 ?? { ...EMPTY_S3 }), ...patch } });
	}

	function updateWebdav(patch: Partial<CloudSyncSettings['webdav']>): void {
		updateSync({ webdav: { ...(currentSync().webdav ?? { ...EMPTY_WEBDAV }), ...patch } });
	}

	let testOk = $state(false);
	let stories = $state<Story[]>([]);
	let storyFilter = $state('');

	async function handleTestConnection(): Promise<void> {
		testOk = false;
		await testCloudSyncConnection();
		testOk = !getCloudSyncError();
	}

	async function handleSyncNow(): Promise<void> {
		testOk = false;
		await runCloudSync();
	}

	$effect(() => {
		refreshCloudSyncStatus();
	});

	$effect(() => {
		if (sync.enabled) {
			// Depend on the last-sync timestamp so stories pulled by a sync
			// show up in the selection list without leaving the page.
			getLastSyncedAt();
			getAllStories()
				.then((s) => (stories = s))
				.catch(() => (stories = []));
		}
	});

	function setStoryExcluded(id: string, name: string, excluded: boolean): void {
		const current = sync.excludedStories ?? [];
		const entries = excluded ? [...current, { id, name }] : current.filter((x) => x.id !== id);
		updateSync({ excludedStories: entries });
	}

	function includeAllStories(): void {
		updateSync({ excludedStories: [] });
	}

	function excludeAllStories(): void {
		const current = sync.excludedStories ?? [];
		const excludedIdSet = new Set(current.map((s) => s.id));
		const newEntries = stories
			.filter((s) => !excludedIdSet.has(s.id))
			.map((s) => ({ id: s.id, name: s.name }));
		updateSync({ excludedStories: [...current, ...newEntries] });
	}

	const REPORT_KEYS: Record<string, string> = {
		pushed: 'cloudSync.reportPushed',
		'pulled-new': 'cloudSync.reportPulledNew',
		merged: 'cloudSync.reportMerged',
		skipped: 'cloudSync.reportSkipped',
		'up-to-date': 'cloudSync.reportSkipped',
		removed: 'cloudSync.reportRemoved',
	};

	const sync = $derived(currentSync());
	const s3 = $derived(sync.s3 ?? EMPTY_S3);
	const webdav = $derived(sync.webdav ?? EMPTY_WEBDAV);
	const s3Warnings = $derived(getUrlWarnings(s3.endpoint, !isTauriSync()));
	const webdavWarnings = $derived(getUrlWarnings(webdav.url, !isTauriSync()));
	const excludedIds = $derived(new Set((sync.excludedStories ?? []).map((s) => s.id)));
	const localIds = $derived(new Set(stories.map((s) => s.id)));
	const displayStories = $derived([
		...stories,
		...(sync.excludedStories ?? []).filter((s) => !localIds.has(s.id)),
	]);
	const filteredStories = $derived(
		storyFilter
			? displayStories.filter((s) => s.name.toLowerCase().includes(storyFilter.toLowerCase()))
			: displayStories
	);
	const includedCount = $derived(displayStories.reduce((n, s) => (excludedIds.has(s.id) ? n : n + 1), 0));
	const corsBypassActive = $derived(!!sync.corsBypassEnabled && !!sync.wispProxyUrl?.trim());
</script>

<div class="space-y-4">
	<Card title={t('cloudSync.enabled')}>
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-4">
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox"
					checked={sync.enabled}
					onchange={(e) => updateSync({ enabled: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<span class="text-sm text-surface-700-300">{t('cloudSync.enabled')}</span>
			</label>

			{#if sync.enabled}
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.backend')}</span>
					<ThemedSelect
						items={[
							{ label: t('cloudSync.backendS3'), value: 's3' },
							{ label: t('cloudSync.backendWebdav'), value: 'webdav' },
						]}
						value={sync.backend}
						onValueChange={(value) => updateSync({ backend: value })}
					/>
				</label>
			{/if}
		</div>
	</Card>

	{#if sync.enabled && sync.backend === 's3'}
		<Card title={t('cloudSync.backendS3')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.s3Endpoint')}</span>
					<input
						class="input mt-1"
						type="url"
						placeholder="e.g. https://<account>.r2.cloudflarestorage.com"
						value={s3.endpoint}
						onchange={(e) => updateS3({ endpoint: (e.currentTarget as HTMLInputElement).value })}
					/>
				</label>
				{#if s3Warnings.cors && !corsBypassActive}
					<p class="text-xs text-warning-500">{t('cloudSync.corsWarning')}</p>
				{/if}
				{#if s3Warnings.insecure}
					<p class="text-xs text-warning-500">{t('cloudSync.insecureTransportWarning')}</p>
				{/if}
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.s3Region')}</span>
					<input
						class="input mt-1"
						placeholder="auto"
						value={s3.region}
						onchange={(e) => updateS3({ region: (e.currentTarget as HTMLInputElement).value })}
					/>
				</label>
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.s3Bucket')}</span>
					<input
						class="input mt-1"
						value={s3.bucket}
						onchange={(e) => updateS3({ bucket: (e.currentTarget as HTMLInputElement).value })}
					/>
				</label>
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.s3Prefix')}</span>
					<input
						class="input mt-1"
						value={s3.prefix}
						onchange={(e) => updateS3({ prefix: (e.currentTarget as HTMLInputElement).value })}
					/>
				</label>
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.s3AccessKeyId')}</span>
					<input
						class="input mt-1"
						value={s3.accessKeyId}
						onchange={(e) => updateS3({ accessKeyId: (e.currentTarget as HTMLInputElement).value })}
					/>
				</label>
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.s3SecretAccessKey')}</span>
					<input
						class="input mt-1"
						type="password"
						value={s3.secretAccessKey}
						onchange={(e) => updateS3({ secretAccessKey: (e.currentTarget as HTMLInputElement).value })}
					/>
				</label>
			</div>
		</Card>
	{/if}

	{#if sync.enabled && sync.backend === 'webdav'}
		<Card title={t('cloudSync.backendWebdav')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.webdavUrl')}</span>
					<input
						class="input mt-1"
						type="url"
						placeholder="e.g. http://192.168.1.100:5005/home/user/hiyori"
						value={webdav.url}
						onchange={(e) => updateWebdav({ url: (e.currentTarget as HTMLInputElement).value })}
					/>
				</label>
				{#if webdavWarnings.cors && !corsBypassActive}
					<p class="text-xs text-warning-500">{t('cloudSync.corsWarning')}</p>
				{/if}
				{#if webdavWarnings.insecure}
					<p class="text-xs text-warning-500">{t('cloudSync.insecureTransportWarning')}</p>
				{/if}
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.webdavUsername')}</span>
					<input
						class="input mt-1"
						value={webdav.username}
						onchange={(e) => updateWebdav({ username: (e.currentTarget as HTMLInputElement).value })}
					/>
				</label>
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.webdavPassword')}</span>
					<input
						class="input mt-1"
						type="password"
						value={webdav.password}
						onchange={(e) => updateWebdav({ password: (e.currentTarget as HTMLInputElement).value })}
					/>
				</label>
			</div>
		</Card>
	{/if}

	{#if sync.enabled && !isTauriSync()}
		<Card title={t('cloudSync.wispProxyTitle')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						class="checkbox"
						checked={sync.corsBypassEnabled ?? false}
						onchange={(e) => updateSync({ corsBypassEnabled: (e.currentTarget as HTMLInputElement).checked })}
					/>
					<span class="text-sm text-surface-700-300">{t('settings.bypassCorsViaWispProxy')}</span>
				</label>
				{#if sync.corsBypassEnabled}
					<label class="block">
						<span class="text-sm font-medium text-surface-700-300">{t('settings.wispProxyUrl')}</span>
						<input
							class="input mt-1"
							type="url"
							placeholder="ws://localhost:6001"
							value={sync.wispProxyUrl ?? ''}
							onchange={(e) => updateSync({ wispProxyUrl: (e.currentTarget as HTMLInputElement).value })}
						/>
					</label>
					<p class="text-xs text-surface-500">{t('settings.wispProxyUrlHint')}</p>
				{/if}
			</div>
		</Card>
	{/if}

	{#if sync.enabled}
		<Card title={t('cloudSync.storiesTitle')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span class="text-xs text-surface-500">
						{t('cloudSync.storiesCount', { count: includedCount, total: displayStories.length })}
					</span>
					<div class="flex gap-2">
						<button class="btn btn-sm preset-tonal min-h-8" type="button" onclick={includeAllStories}>
							{t('cloudSync.selectAll')}
						</button>
						<button class="btn btn-sm preset-tonal min-h-8" type="button" onclick={excludeAllStories}>
							{t('cloudSync.deselectAll')}
						</button>
					</div>
				</div>
				<input
					class="input"
					type="search"
					placeholder={t('cloudSync.storiesSearch')}
					bind:value={storyFilter}
				/>
				<div class="max-h-64 overflow-y-auto space-y-1">
					{#each filteredStories as story (story.id)}
						<label class="flex items-center gap-2 p-1 rounded hover:bg-surface-200-800 cursor-pointer">
							<input
								type="checkbox"
								class="checkbox"
								checked={!excludedIds.has(story.id)}
								onchange={(e) =>
									setStoryExcluded(story.id, story.name, !(e.currentTarget as HTMLInputElement).checked)}
							/>
							<span class="text-sm text-surface-700-300 truncate">{story.name}</span>
						</label>
					{:else}
						<p class="text-sm text-surface-500">{t('cloudSync.noStories')}</p>
					{/each}
				</div>
				<p class="text-xs text-surface-500">{t('cloudSync.storiesExclusionHint')}</p>
			</div>
		</Card>
	{/if}

	{#if sync.enabled}
		<Card title={t('cloudSync.syncNow')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<div class="flex flex-wrap gap-2">
					<button
						class="btn preset-tonal min-h-11"
						type="button"
						disabled={getCloudSyncStatus() === 'testing'}
						onclick={handleTestConnection}
					>
						{getCloudSyncStatus() === 'testing' ? '…' : t('cloudSync.testConnection')}
					</button>
					<button
						class="btn preset-filled-primary-500 min-h-11"
						type="button"
						disabled={getCloudSyncStatus() === 'syncing'}
						onclick={handleSyncNow}
					>
						{getCloudSyncStatus() === 'syncing' ? t('cloudSync.syncing') : t('cloudSync.syncNow')}
					</button>
				</div>

				{#if testOk}
					<p class="text-sm text-success-500">{t('cloudSync.connectionOk')}</p>
				{/if}
				{#if getCloudSyncError()}
					<p class="text-sm text-error-500 whitespace-pre-wrap">{getCloudSyncError()}</p>
				{/if}

				<p class="text-sm text-surface-500">
					{#if getLastSyncedAt()}
						{t('cloudSync.lastSynced', { time: new Date(getLastSyncedAt()!).toLocaleString() })}
					{:else}
						{t('cloudSync.neverSynced')}
					{/if}
				</p>

				{#if getLastSyncReport()?.entries.length}
					<ul class="space-y-1">
						{#each getLastSyncReport()!.entries as entry (entry.storyId + entry.action)}
							<li class="text-sm text-surface-700-300">
								{t(REPORT_KEYS[entry.action] ?? 'cloudSync.reportSkipped', { name: entry.storyName })}
							</li>
						{/each}
					</ul>
				{/if}
				{#if getLastSyncReport()?.errors.length}
					<ul class="space-y-1">
						{#each getLastSyncReport()!.errors as error (error)}
							<li class="text-sm text-error-500">{error}</li>
						{/each}
					</ul>
				{/if}
			</div>
		</Card>
	{:else}
		<p class="text-sm text-surface-500">{t('cloudSync.unconfigured')}</p>
	{/if}
</div>
