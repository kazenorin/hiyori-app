<script lang="ts">
	import { t } from '$lib/i18n';
	import { mobileNav, mobileFeatures } from '$lib/stores/mobile-nav.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		onOpenSidebar?: () => void;
	}

	let { onOpenSidebar }: Props = $props();

	let isOnChat = $derived($page.url.pathname === '/');

	function handleTabClick(tab: 'chat' | 'choices' | 'menu') {
		// Always dismiss expanded input sheet on any tab click
		mobileNav.inputSheetOpen = false;

		if (!isOnChat) {
			// On secondary pages, all tabs navigate back to chat first
			goto('/');
		}

		if (tab === 'menu') {
			onOpenSidebar?.();
			mobileNav.activeTab = 'chat';
		} else if (tab === 'choices') {
			mobileNav.activeTab = mobileNav.activeTab === 'choices' ? 'chat' : 'choices';
		} else {
			mobileNav.activeTab = 'chat';
		}
	}
</script>

{#if mobileFeatures.isPhone}
	<div class="fixed bottom-0 left-0 right-0 z-40 bg-surface-50-950 border-t border-surface-200-800 pb-safe">
		<div class="flex items-center justify-around h-[52px]">
			<!-- Chat Tab -->
			<button
				type="button"
				class="flex flex-col items-center justify-center flex-1 h-full gap-0.5 {mobileNav.activeTab === 'chat'
					? 'text-primary-500'
					: 'text-surface-500'}"
				onclick={() => handleTabClick('chat')}
				aria-label={t('bottomNav.chat')}
			>
				<Icon name="chat-bubble" class="h-5 w-5" />
				<span class="text-[10px] font-medium">{t('bottomNav.chat')}</span>
			</button>

			<!-- Choices Tab (with badge) -->
			<button
				type="button"
				class="flex flex-col items-center justify-center flex-1 h-full gap-0.5 relative {mobileNav.activeTab === 'choices'
					? 'text-primary-500'
					: 'text-surface-500'}"
				onclick={() => handleTabClick('choices')}
				aria-label={t('bottomNav.choices')}
			>
				<div class="relative">
					<Icon name="bolt" class="h-5 w-5" />
					{#if mobileNav.choicesCount > 0}
						<span
							class="absolute -top-1.5 -right-2.5 bg-error-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1"
						>
							{mobileNav.choicesCount}
						</span>
					{/if}
				</div>
				<span class="text-[10px] font-medium">{t('bottomNav.choices')}</span>
			</button>

			<!-- Menu Tab -->
			<button
				type="button"
				class="flex flex-col items-center justify-center flex-1 h-full gap-0.5 {mobileNav.activeTab === 'menu'
					? 'text-primary-500'
					: 'text-surface-500'}"
				onclick={() => handleTabClick('menu')}
				aria-label={t('bottomNav.menu')}
			>
				<Icon name="menu" class="h-5 w-5" />
				<span class="text-[10px] font-medium">{t('bottomNav.menu')}</span>
			</button>
		</div>
	</div>
{/if}
