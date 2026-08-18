<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { settings, updateSettings, type Settings } from '$lib/stores/settings.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import { isTauriSync } from '$lib/runtime';
	import { getUrlWarnings } from '$lib/utils/url-security';
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

	async function handleTestConnection(): Promise<void> {
		testOk = false;
		await testCloudSyncConnection();
		testOk = !getCloudSyncError();
	}

	async function handleSyncNow(): Promise<void> {
		testOk = false;
		await runCloudSync();
	}

	function handleBack(): void {
		goto(resolve('/settings'));
	}

	$effect(() => {
		refreshCloudSyncStatus();
	});

	const REPORT_KEYS: Record<string, string> = {
		pushed: 'cloudSync.reportPushed',
		'pulled-new': 'cloudSync.reportPulledNew',
		merged: 'cloudSync.reportMerged',
		skipped: 'cloudSync.reportSkipped',
		'up-to-date': 'cloudSync.reportSkipped',
	};

	const sync = $derived(currentSync());
	const s3 = $derived(sync.s3 ?? EMPTY_S3);
	const webdav = $derived(sync.webdav ?? EMPTY_WEBDAV);
	const s3Warnings = $derived(getUrlWarnings(s3.endpoint, !isTauriSync()));
	const webdavWarnings = $derived(getUrlWarnings(webdav.url, !isTauriSync()));
</script>

<svelte:head>
	<title>{t('cloudSync.title')}</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
	<div class="max-w-2xl mx-auto space-y-6">
		<div class="space-y-2">
			<button class="btn btn-sm preset-tonal min-h-11 inline-flex self-start" onclick={handleBack}>
				&larr; {t('settings.back')}
			</button>
			<h1 class="h2 font-display">{t('cloudSync.title')}</h1>
			<p class="text-sm text-surface-500">{t('cloudSync.description')}</p>
		</div>

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
					{#if s3Warnings.cors}
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
						<input class="input mt-1" value={s3.bucket} onchange={(e) => updateS3({ bucket: (e.currentTarget as HTMLInputElement).value })} />
					</label>
					<label class="block">
						<span class="text-sm font-medium text-surface-700-300">{t('cloudSync.s3Prefix')}</span>
						<input class="input mt-1" value={s3.prefix} onchange={(e) => updateS3({ prefix: (e.currentTarget as HTMLInputElement).value })} />
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
					{#if webdavWarnings.cors}
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
								<li class="text-sm text-surface-700-300">{t(REPORT_KEYS[entry.action] ?? 'cloudSync.reportSkipped', { name: entry.storyName })}</li>
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
</div>
