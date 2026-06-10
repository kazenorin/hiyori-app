<script lang="ts">
	import { t } from '$lib/i18n';
	import { mobileNav, mobileFeatures } from '$lib/stores/mobile-nav.svelte';
	import { getIsActive as getIsWorldBuilderActive } from '$lib/features/world-builder/world-builder.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { IconName } from '$lib/ui/icons';

	interface Props {
		onOpenSidebar?: () => void;
	}

	let { onOpenSidebar }: Props = $props();

	let isOnChat = $derived(page.url.pathname === '/');
	let isWorldBuilder = $derived(getIsWorldBuilderActive());

	type TabId = 'chat' | 'choices' | 'menu';
	type Tab = { id: TabId; icon: IconName; labelKey: string; hasBadge?: boolean; hidden?: boolean; highlight?: boolean };

	let tabs = $derived.by(() => {
		const allTabs: Tab[] = [
			{ id: 'chat', icon: 'chat-bubble', labelKey: 'bottomNav.chat', highlight: isWorldBuilder },
			{ id: 'choices', icon: 'bolt', labelKey: 'bottomNav.choices', hasBadge: true, hidden: isWorldBuilder },
			{ id: 'menu', icon: 'menu', labelKey: 'bottomNav.menu' },
		];
		return allTabs.filter((tab) => !tab.hidden);
	});

	function handleTabClick(tab: TabId) {
		if (!isOnChat) {
			// On secondary pages, all tabs navigate back to chat first
			goto('/');
			mobileNav.activeTab = 'chat';
			mobileNav.inputSheetOpen = false;
			return;
		}

		if (tab === 'menu') {
			mobileNav.inputSheetOpen = false;
			onOpenSidebar?.();
			mobileNav.activeTab = 'chat';
		} else if (tab === 'choices') {
			mobileNav.inputSheetOpen = false;
			mobileNav.activeTab = mobileNav.activeTab === 'choices' ? 'chat' : 'choices';
		} else {
			// Chat tab
			if (mobileNav.activeTab !== 'chat') {
				mobileNav.activeTab = 'chat';
				mobileNav.inputSheetOpen = false;
			} else {
				// Already on chat tab → toggle input sheet
				mobileNav.inputSheetOpen = !mobileNav.inputSheetOpen;
			}
		}
	}
</script>

{#if mobileFeatures.isPhone}
	<div class="fixed bottom-0 left-0 right-0 z-40 bg-surface-50-950 border-t border-surface-200-800 pb-safe">
		<div class="flex items-center justify-around h-[52px]">
			{#each tabs as tab (tab.id)}
				{@const highlight = tab.highlight ?? false}
				<button
					type="button"
					class="flex flex-col items-center justify-center flex-1 h-full gap-0.5 {highlight || mobileNav.activeTab === tab.id
						? 'text-primary-500'
						: 'text-surface-500'}"
					onclick={() => handleTabClick(tab.id)}
					aria-label={t(tab.labelKey)}
				>
					{#if tab.hasBadge}
						<div class="relative">
							<Icon name={tab.icon} class={highlight ? 'h-6 w-6' : 'h-5 w-5'} />
							{#if mobileNav.choicesCount > 0}
								<span
									class="absolute -top-1.5 -right-2.5 bg-error-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1"
								>
									{mobileNav.choicesCount}
								</span>
							{/if}
						</div>
					{:else}
						<Icon name={tab.icon} class={highlight ? 'h-6 w-6' : 'h-5 w-5'} />
					{/if}
					<span class={highlight ? 'text-xs font-semibold' : 'text-[10px] font-medium'}>{t(tab.labelKey)}</span>
				</button>
			{/each}
		</div>
	</div>
{/if}
