<script lang="ts">
	import { t } from '$lib/i18n';

	interface EditFormData {
		content?: string;
		variables?: {
			sceneTitle?: string;
			background?: string;
			narrativeBody?: string;
			cg?: string;
		};
	}

	interface Props {
		mode: 'wb-user' | 'wb-assistant' | 'main';
		isTemplated?: boolean;
		messageId: string;
		initial: EditFormData;
		onsave: (data: EditFormData) => void;
		oncancel: () => void;
	}

	let { mode, isTemplated = false, messageId, initial, onsave, oncancel }: Props = $props();

	// Snapshot the initial values once, so reference the edit form contains the initial data
	// svelte-ignore state_referenced_locally
	let formContent = $state(initial.content ?? '');
	// svelte-ignore state_referenced_locally
	let formSceneTitle = $state(initial.variables?.sceneTitle ?? '');
	// svelte-ignore state_referenced_locally
	let formBackground = $state(initial.variables?.background ?? '');
	// svelte-ignore state_referenced_locally
	let formNarrativeBody = $state(initial.variables?.narrativeBody ?? '');
	// svelte-ignore state_referenced_locally
	let formCg = $state(initial.variables?.cg ?? '');

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			handleSave();
		}
	}

	function handleSave() {
		if (isTemplated && mode === 'main') {
			onsave({
				variables: {
					sceneTitle: formSceneTitle || undefined,
					background: formBackground || undefined,
					narrativeBody: formNarrativeBody || undefined,
					cg: formCg || undefined,
				},
			});
		} else {
			onsave({ content: formContent });
		}
	}
</script>

{#if mode === 'main' && isTemplated}
	<div>
		<div class="space-y-3 mt-2">
			<div>
				<label for="edit-scene-title-{messageId}" class="block text-xs font-medium text-surface-500 mb-1">{t('chat.sceneTitle')}</label>
				<textarea
					id="edit-scene-title-{messageId}"
					class="input w-full resize-y text-sm leading-relaxed min-h-8"
					rows="1"
					bind:value={formSceneTitle}
					onkeydown={handleKeydown}
				></textarea>
			</div>
			<div>
				<label for="edit-background-{messageId}" class="block text-xs font-medium text-surface-500 mb-1">{t('chat.background')}</label>
				<textarea
					id="edit-background-{messageId}"
					class="input w-full resize-y text-sm leading-relaxed min-h-16"
					rows="3"
					bind:value={formBackground}
					onkeydown={handleKeydown}
				></textarea>
			</div>
			<div>
				<label for="edit-narrative-body-{messageId}" class="block text-xs font-medium text-surface-500 mb-1"
					>{t('chat.narrativeBody')}</label
				>
				<textarea
					id="edit-narrative-body-{messageId}"
					class="input w-full resize-y text-sm leading-relaxed min-h-32"
					rows="8"
					bind:value={formNarrativeBody}
					onkeydown={handleKeydown}
				></textarea>
			</div>
			<div>
				<label for="edit-cg-{messageId}" class="block text-xs font-medium text-surface-500 mb-1">{t('chat.cg')}</label>
				<textarea
					id="edit-cg-{messageId}"
					class="input w-full resize-y text-sm leading-relaxed min-h-8"
					rows="1"
					bind:value={formCg}
					onkeydown={handleKeydown}
				></textarea>
			</div>
		</div>
	</div>
	<div class="flex gap-2 mt-3 pt-3 border-t border-surface-200-800">
		<button class="btn preset-filled-primary-500 text-xs py-1 px-3" onclick={handleSave}>{t('chat.save')}</button>
		<button class="btn preset-tonal text-xs py-1 px-3" onclick={oncancel}>{t('chat.cancel')}</button>
	</div>
{:else}
	<textarea
		class="input w-full resize-y text-sm leading-relaxed {mode === 'wb-user'
			? 'min-h-20 bg-surface-50-950 text-primary-900-100'
			: 'min-h-32'}"
		bind:value={formContent}
		onkeydown={handleKeydown}
	></textarea>
	<div class="flex gap-2 {mode === 'main' ? 'mt-3 pt-3 border-t border-surface-200-800' : 'mt-2'}">
		<button class="btn preset-filled-primary-500 text-xs py-1 px-3" onclick={handleSave}>{t('chat.save')}</button>
		<button class="btn preset-tonal text-xs py-1 px-3" onclick={oncancel}>{t('chat.cancel')}</button>
	</div>
{/if}
