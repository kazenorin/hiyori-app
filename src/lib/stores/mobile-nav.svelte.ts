// Mobile navigation state shared between layout and pages
export let mobileNav = $state({
	activeTab: 'chat' as 'chat' | 'choices' | 'menu',
	choicesCount: 0,
	inputSheetOpen: false,
});

// Derived from viewport width — set once on mount in +layout
export let mobileFeatures = $state({
	isPhone: false,
});
