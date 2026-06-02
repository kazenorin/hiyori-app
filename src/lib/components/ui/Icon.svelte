<script lang="ts">
	import { ICONS, type IconName } from '$lib/ui/icons';

	interface Props {
		name: IconName;
		class?: string;
		'aria-label'?: string;
		'aria-hidden'?: boolean | 'true' | 'false';
	}

	let { name, class: className = '', 'aria-label': ariaLabel, 'aria-hidden': ariaHidden, ...rest }: Props = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox={ICONS[name].viewBox}
	fill={ICONS[name].fill ?? 'none'}
	stroke={ICONS[name].stroke ?? 'currentColor'}
	stroke-width={ICONS[name].strokeWidth ?? 2}
	stroke-linecap={ICONS[name].strokeLinecap ?? 'round'}
	stroke-linejoin={ICONS[name].strokeLinejoin ?? 'round'}
	class={className}
	aria-label={ariaLabel}
	aria-hidden={ariaHidden ?? (ariaLabel ? undefined : true)}
	{...rest}>{@html ICONS[name].body}</svg
>
