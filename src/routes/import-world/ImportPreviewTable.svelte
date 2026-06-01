<script lang="ts">
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import type { ImportPreviewAct, ImportPreviewMessage } from '$lib/features/import-world/types';
	import { t } from '$lib/i18n';

	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	interface Props {
		acts: ImportPreviewAct[];
		onToggleRemoved: (actIndex: number, messageIndex: number) => void;
	}

	let { acts, onToggleRemoved }: Props = $props();

	let expandedIds = new SvelteSet<string>();

	function toggleExpand(id: string) {
		if (expandedIds.has(id)) {
			expandedIds.delete(id);
		} else {
			expandedIds.add(id);
		}
	}

	function computeSceneNumbers(messages: ImportPreviewMessage[]): SvelteMap<string, number> {
		const result = new SvelteMap<string, number>();
		let currentScene = 1;

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			if (msg.role === 'system' || msg.removed) continue;

			result.set(msg.id, currentScene);

			if (msg.role === 'user') {
				const nextAssistant = messages.findIndex((m, j) => j > i && !m.removed && m.role === 'assistant');
				if (nextAssistant !== -1) currentScene++;
			}
		}

		return result;
	}

	function truncate(text: string, maxLen: number = 120): string {
		if (text.length <= maxLen) return text;
		return text.slice(0, maxLen) + '…';
	}

	function getExcerpt(msg: ImportPreviewMessage): string {
		const body = msg.variables?.narrativeBody ?? msg.content;
		return body.replace(/\n/g, ' ').trim();
	}

	function visibleCount(messages: ImportPreviewMessage[]): number {
		return messages.filter((m) => !m.removed && m.role !== 'system').length;
	}
</script>

<Accordion collapsible>
	{#each acts as act, actIndex (act.actId)}
		{@const sceneNumbers = computeSceneNumbers(act.messages)}
		{@const count = visibleCount(act.messages)}
		<Accordion.Item value={act.actId}>
			<Accordion.ItemTrigger class="flex items-center gap-2">
				<span class="font-semibold">{act.actName}</span>
				<span class="text-xs text-surface-500">({count} {t('importWorld.messages')})</span>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent>
				{#snippet element(attributes)}
					{#if !attributes.hidden}
						<div {...attributes}>
							<div class="overflow-x-auto md:overflow-visible">
								<table class="w-full border-collapse text-sm min-w-[600px] md:min-w-0">
									<thead>
										<tr class="border-b border-surface-200-800">
											<th class="px-3 py-2 text-left text-xs font-semibold text-surface-500 w-16">{t('importWorld.sceneNumber')}</th>
											<th class="px-3 py-2 text-left text-xs font-semibold text-surface-500 w-20">{t('importWorld.role')}</th>
											<th class="px-3 py-2 text-left text-xs font-semibold text-surface-500 w-40">{t('importWorld.sceneTitle')}</th>
											<th class="px-3 py-2 text-left text-xs font-semibold text-surface-500">{t('importWorld.excerpt')}</th>
											<th class="px-3 py-2 text-left text-xs font-semibold text-surface-500 w-14"></th>
										</tr>
									</thead>
									<tbody>
										{#each act.messages as msg, messageIndex (msg.id)}
											{#if msg.role !== 'system'}
												{@const isRemoved = msg.removed}
												{@const sceneNum = sceneNumbers.get(msg.id)}
												<tr class="border-b border-surface-200-800 transition-opacity {isRemoved ? 'opacity-30 line-through' : ''}">
													<td class="px-3 py-2 text-surface-500 font-mono text-xs">
														{sceneNum ?? '—'}
													</td>
													<td class="px-3 py-2">
														<span
															class="text-xs px-1.5 py-0.5 rounded {msg.role === 'assistant'
																? 'bg-primary-100-900 text-primary-600'
																: 'bg-surface-200-800 text-surface-600'}"
														>
															{msg.role === 'assistant' ? t('importWorld.assistant') : t('importWorld.user')}
														</span>
													</td>
													<td class="px-3 py-2 text-surface-700-300 text-xs">
														{msg.role === 'assistant' ? msg.variables?.sceneTitle || '—' : '—'}
													</td>
													<td class="px-3 py-2">
														{#if msg.role === 'assistant'}
															{#if expandedIds.has(msg.id)}
																<div class="max-h-64 overflow-y-auto text-xs text-surface-700-300 whitespace-pre-wrap">
																	{getExcerpt(msg)}
																</div>
																<button class="text-xs text-primary-500 hover:underline mt-1" onclick={() => toggleExpand(msg.id)}>
																	{t('importWorld.showLess')}
																</button>
															{:else}
																<span class="text-xs text-surface-700-300">{truncate(getExcerpt(msg))}</span>
																{#if getExcerpt(msg).length > 120}
																	<button class="text-xs text-primary-500 hover:underline ml-1" onclick={() => toggleExpand(msg.id)}>
																		{t('importWorld.showMore')}
																	</button>
																{/if}
															{/if}
														{:else if expandedIds.has(msg.id)}
															<div class="max-h-64 overflow-y-auto text-xs text-surface-700-300 whitespace-pre-wrap">
																{msg.content}
															</div>
															<button class="text-xs text-primary-500 hover:underline mt-1" onclick={() => toggleExpand(msg.id)}>
																{t('importWorld.showLess')}
															</button>
														{:else}
															<span class="text-xs text-surface-700-300">{truncate(msg.content)}</span>
															{#if msg.content.length > 120}
																<button class="text-xs text-primary-500 hover:underline ml-1" onclick={() => toggleExpand(msg.id)}>
																	{t('importWorld.showMore')}
																</button>
															{/if}
														{/if}
													</td>
													<td class="px-3 py-2">
														<button
															class="text-xs {isRemoved ? 'text-primary-500 hover:underline' : 'text-error-500 hover:underline'}"
															onclick={() => onToggleRemoved(actIndex, messageIndex)}
														>
															{isRemoved ? t('importWorld.restoreMessage') : t('importWorld.removeMessage')}
														</button>
													</td>
												</tr>
											{/if}
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/if}
				{/snippet}
			</Accordion.ItemContent>
		</Accordion.Item>
	{/each}
</Accordion>
