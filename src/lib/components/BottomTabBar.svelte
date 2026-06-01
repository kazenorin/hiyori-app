<script lang="ts">
	import { t } from '$lib/i18n';
	import { mobileNav, mobileFeatures } from '$lib/stores/mobile-nav.svelte';

	interface Props {
		sidebarOpen?: boolean;
		onOpenSidebar?: () => void;
	}

	let { sidebarOpen = false, onOpenSidebar }: Props = $props();

	function handleTabClick(tab: 'chat' | 'choices' | 'menu') {
		// Always dismiss expanded input sheet on any tab click
		mobileNav.inputSheetOpen = false;

		if (tab === 'menu') {
			onOpenSidebar?.();
			// Hide choices sheet when menu opens
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
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
				</svg>
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
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
					</svg>
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
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<line x1="3" y1="12" x2="21" y2="12" />
					<line x1="3" y1="6" x2="21" y2="6" />
					<line x1="3" y1="18" x2="21" y2="18" />
				</svg>
				<span class="text-[10px] font-medium">{t('bottomNav.menu')}</span>
			</button>
		</div>
	</div>
{/if}
