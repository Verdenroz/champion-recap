<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';

	interface AxisXTimeProps {
		formatTick?: (value: any) => string;
		ticks?: number;
	}

	let { formatTick = (d: any) => String(d), ticks = 6 }: AxisXTimeProps = $props();

	interface LayerCakeContext {
		width: Writable<number>;
		height: Writable<number>;
		xScale: Writable<any>;
	}

	const { width, height, xScale } = getContext('LayerCake') as LayerCakeContext;

	let tickValues = $derived.by(() => {
		if ($xScale && typeof $xScale.ticks === 'function') {
			return $xScale.ticks(ticks);
		}
		return [];
	});
</script>

<g class="axis axis-x" transform="translate(0, {$height})">
	{#each tickValues as tick (tick)}
		<g class="tick" transform="translate({$xScale(tick)}, 0)">
			<line y1="0" y2="6" stroke="currentColor" />
			<text y="9" dy="0.71em" fill="currentColor" text-anchor="middle">
				{formatTick(tick)}
			</text>
		</g>
	{/each}
</g>

<style>
	.axis {
		font-size: 11px;
	}

	.tick {
		opacity: 0.7;
	}

	.tick text {
		fill: var(--color-gray-400);
	}

	.tick line {
		stroke: var(--color-gray-600);
	}
</style>
