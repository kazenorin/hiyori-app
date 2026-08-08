<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { settings, updateSettings } from '$lib/stores/settings.svelte';
	import { getVoicesForLocale } from '$lib/kokoro/locale-mapping';
	import { isModelCached } from '$lib/kokoro/model';
	import { isVoiceFileCached } from '$lib/kokoro/kokoro-hiyori/voices';
	import { TTS_MODELS, TTS_PREVIEW_TEXT, TTS_SPEED_MAX, TTS_SPEED_MIN, TTS_SPEED_STEP, type TTSModelKey } from '$lib/kokoro/constants';
	import { ttsPlayer } from '$lib/kokoro/player.svelte';
	import VoiceSelector from '$lib/components/tts/VoiceSelector.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import ProgressField from '$lib/components/ui/ProgressField.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import type { VoiceId, VoiceInfo } from '$lib/kokoro/kokoro-hiyori';

	const TTS_LOCALES = ['en', 'zh-Hant-HK'] as const;

	const localeVoices = $derived(
		Object.fromEntries(TTS_LOCALES.map((locale) => [locale, getVoicesForLocale(locale)])) as Record<string, [VoiceId, VoiceInfo][]>
	);

	let modelCached = $state<Record<TTSModelKey, boolean>>({ 'v1.0': false, 'v1.1-zh': false });
	let voiceCached = $state<Record<string, boolean>>({});
	let previewingVoice = $state<VoiceId | null>(null);

	let downloadModalOpen = $state(false);
	let pendingDownloadModel = $state<TTSModelKey | null>(null);
	let pendingPreviewVoice = $state<{ locale: string; id: VoiceId } | null>(null);
	let pendingSelect = $state<{ locale: string; id: VoiceId } | null>(null);
	let downloadProgress = $state<number | null>(null);
	let downloadError = $state<string | null>(null);
	let downloading = $state(false);

	async function refreshStatus(): Promise<void> {
		const nextModel: Record<TTSModelKey, boolean> = { 'v1.0': false, 'v1.1-zh': false };
		nextModel['v1.0'] = await isModelCached('v1.0');
		nextModel['v1.1-zh'] = await isModelCached('v1.1-zh');
		modelCached = nextModel;

		const nextVoice: Record<string, boolean> = {};
		for (const locale of TTS_LOCALES) {
			for (const [id] of getVoicesForLocale(locale)) {
				nextVoice[id] = await isVoiceFileCached(id);
			}
		}
		voiceCached = nextVoice;
	}

	$effect(() => {
		void refreshStatus();
	});

	function handleSelect(locale: string, id: VoiceId | null): void {
		updateSettings({ ttsVoices: { ...settings.ttsVoices, [locale]: id } });
	}

	function handlePreview(locale: string, id: VoiceId): void {
		if (previewingVoice === id) {
			ttsPlayer.stop();
			previewingVoice = null;
			return;
		}
		ttsPlayer.stop();
		previewingVoice = id;
		ttsPlayer.play(TTS_PREVIEW_TEXT[locale] ?? '', 'tts-preview', id, settings.ttsSpeed);
	}

	$effect(() => {
		if (previewingVoice && ttsPlayer.playingMessageId !== 'tts-preview') {
			previewingVoice = null;
		}
	});

	function requestDownload(
		model: TTSModelKey,
		previewVoice: { locale: string; id: VoiceId } | null,
		select: { locale: string; id: VoiceId } | null = null
	): void {
		pendingDownloadModel = model;
		pendingPreviewVoice = previewVoice;
		pendingSelect = select;
		downloadError = null;
		downloadModalOpen = true;
	}

	function handleDownloadConfirm(): void {
		if (!pendingDownloadModel) return;
		downloading = true;
		downloadProgress = 0;
		downloadError = null;

		const model = pendingDownloadModel;
		ttsPlayer.loadModel(model, {
			onProgress: (progress: number) => {
				downloadProgress = progress;
			},
			onError: (error: string) => {
				downloadError = error;
				downloading = false;
			},
			onReady: () => {
				downloading = false;
				downloadProgress = null;
				downloadModalOpen = false;
				modelCached[model] = true;
				pendingDownloadModel = null;
				const preview = pendingPreviewVoice;
				pendingPreviewVoice = null;
				const applySelect = pendingSelect;
				pendingSelect = null;
				if (applySelect) handleSelect(applySelect.locale, applySelect.id);
				if (preview) handlePreview(preview.locale, preview.id);
			},
		});
	}

	function handleDownloadCancel(): void {
		ttsPlayer.cancelLoad();
		downloadModalOpen = false;
		pendingDownloadModel = null;
		pendingPreviewVoice = null;
		pendingSelect = null;
		downloadProgress = null;
		downloadError = null;
		downloading = false;
	}

	function handleBack(): void {
		goto(resolve('/settings'));
	}
</script>

<svelte:head>
	<title>{t('settings.ttsConfig.title')}</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
	<div class="max-w-2xl mx-auto space-y-6">
		<div class="space-y-2">
			<button class="btn btn-sm preset-tonal min-h-11 inline-flex self-start" onclick={handleBack}>
				&larr; {t('settings.back')}
			</button>
			<h1 class="h2 font-display">{t('settings.ttsConfig.title')}</h1>
			<p class="text-sm text-surface-500">{t('settings.ttsConfig.description')}</p>
		</div>

		<Card title={t('tts.speed')} description={t('tts.speedDescription')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4">
				<div class="flex items-center gap-3">
					<input
						type="range"
						class="flex-1 cursor-pointer"
						min={TTS_SPEED_MIN}
						max={TTS_SPEED_MAX}
						step={TTS_SPEED_STEP}
						value={settings.ttsSpeed}
						oninput={(e) => updateSettings({ ttsSpeed: parseFloat((e.target as HTMLInputElement).value) })}
					/>
					<span class="text-sm tabular-nums min-w-[3ch] text-surface-700-300">{settings.ttsSpeed.toFixed(1)}×</span>
				</div>
			</div>
		</Card>

		{#each TTS_LOCALES as locale (locale)}
			<Card title={t(`settings.ttsConfig.locale.${locale}`)}>
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<VoiceSelector
						voices={localeVoices[locale]}
						selected={settings.ttsVoices[locale]}
						previewing={previewingVoice}
						{modelCached}
						{voiceCached}
						onSelect={(id) => {
							if (id) {
								const voice = getVoicesForLocale(locale).find(([vid]) => vid === id)?.[1];
								if (voice && !modelCached[voice.model]) {
									requestDownload(voice.model, null);
								}
							}
							handleSelect(locale, id);
						}}
						onPreview={(id) => {
							const voice = getVoicesForLocale(locale).find(([vid]) => vid === id)?.[1];
							if (voice && !modelCached[voice.model]) {
								requestDownload(voice.model, { locale, id });
								return;
							}
							handlePreview(locale, id);
						}}
					/>
				</div>
			</Card>
		{/each}
	</div>
</div>

<Modal bind:open={downloadModalOpen} title={t('tts.downloadModelTitle')}>
	{#snippet body()}
		<p class="text-sm text-surface-700-300">
			{t('tts.downloadModelDescription', {
				model: pendingDownloadModel ? TTS_MODELS[pendingDownloadModel].label : '',
			})}
		</p>
		{#if downloadProgress !== null}
			<ProgressField value={downloadProgress} label={`${downloadProgress}%`} visible={true} />
		{/if}
		{#if downloadError}
			<p class="text-sm text-error-500 mt-2">{downloadError}</p>
		{/if}
	{/snippet}
	{#snippet footer()}
		<div class="flex gap-2">
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors min-h-11"
				type="button"
				disabled={downloading}
				onclick={handleDownloadCancel}
			>
				{t('tts.cancelDownload')}
			</button>
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors min-h-11"
				type="button"
				disabled={downloading}
				onclick={handleDownloadConfirm}
			>
				{downloading ? t('tts.downloading') : t('tts.startDownload')}
			</button>
		</div>
	{/snippet}
</Modal>
