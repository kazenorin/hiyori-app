<script lang="ts">
	import { t } from '$lib/i18n';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { getVoiceLabel } from '$lib/kokoro/voices';
	import type { VoiceId, VoiceInfo } from '$lib/kokoro/kokoro-hiyori';
	import type { TTSModelKey } from '$lib/kokoro/constants';

	interface Props {
		voices: [VoiceId, VoiceInfo][];
		selected: VoiceId | null;
		modelCached: Record<TTSModelKey, boolean>;
		voiceCached: Record<string, boolean>;
		onSelect: (id: VoiceId | null) => void;
		onPreview: (id: VoiceId) => void;
	}

	let { voices, selected, modelCached, voiceCached, onSelect, onPreview }: Props = $props();

	let open = $state(false);

	const selectedVoice = $derived(voices.find(([id]) => id === selected)?.[1]);
	const selectedLabel = $derived(selected && selectedVoice ? getVoiceLabel(selectedVoice) : t('tts.disabled'));

	function handleSelect(id: VoiceId | null): void {
		onSelect(id);
		open = false;
	}
</script>

<div class="space-y-2">
	<button
		type="button"
		class="w-full px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm font-medium transition-colors min-h-11 text-left flex items-center justify-between gap-2"
		onclick={() => (open = true)}
	>
		<span class="truncate">{selectedLabel}</span>
		<Icon name="cog" class="w-4 h-4 shrink-0" />
	</button>

	<Modal bind:open title={t('tts.chooseVoice')} width="lg" onclose={() => (open = false)}>
		{#snippet body()}
			<div class="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
				<button
					type="button"
					class="w-full px-3 py-2 rounded-lg text-left text-sm transition-colors flex items-center justify-between gap-2 {selected === null
						? 'bg-primary-500/10 text-primary-500'
						: 'hover:bg-surface-200-800'}"
					onclick={() => handleSelect(null)}
				>
					<span>{t('tts.disabled')}</span>
					{#if selected === null}
						<Icon name="check" class="w-4 h-4 shrink-0" />
					{/if}
				</button>
				{#each voices as [id, voice] (id)}
					<div
						class="w-full px-3 py-2 rounded-lg text-left text-sm transition-colors flex items-center justify-between gap-2 {selected === id
							? 'bg-primary-500/10 text-primary-500'
							: 'hover:bg-surface-200-800'}"
					>
						<div class="min-w-0">
							<div class="font-medium truncate">{getVoiceLabel(voice)}</div>
							<div class="flex items-center gap-2 mt-0.5">
								{#if modelCached[voice.model]}
									<span class="inline-flex items-center gap-0.5 text-xs text-success-500">
										<Icon name="download" class="w-3 h-3" />
										{t('tts.modelDownloaded')}
									</span>
								{/if}
								{#if voiceCached[id]}
									<span class="inline-flex items-center gap-0.5 text-xs text-success-500">
										<Icon name="check" class="w-3 h-3" />
										{t('tts.voiceDownloaded')}
									</span>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-1 shrink-0">
							<button
								type="button"
								class="p-2 rounded-lg hover:bg-surface-200-800 text-surface-500 hover:text-primary-500 transition-colors"
								title={t('tts.preview')}
								aria-label={t('tts.preview')}
								onclick={() => onPreview(id)}
							>
								<Icon name="sparkles" class="w-4 h-4" />
							</button>
							<button
								type="button"
								class="p-2 rounded-lg hover:bg-surface-200-800 text-primary-500 transition-colors"
								title={t('tts.select')}
								aria-label={t('tts.select')}
								onclick={() => handleSelect(id)}
							>
								<Icon name="check" class="w-4 h-4" />
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/snippet}
	</Modal>
</div>
