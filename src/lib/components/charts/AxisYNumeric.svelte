<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';

	interface AxisYNumericProps {
		formatTick?: (value: number) => string;
		ticks?: number;
	}

	let { formatTick = (d: number) => String(d), ticks = 4 }: AxisYNumericProps = $props();

	interface LayerCakeContext {
		yScale: Writable<any>;
	}

	const { yScale } = getContext('LayerCake') as LayerCakeContext;

	let tickValues = $derived.by(() => {
		if ($yScale && typeof $yScale.ticks === 'function') {
			return $yScale.ticks(ticks);
		}
		return [];
	});
</script>

<g class="axis axis-y">
	{#each tickValues as tick (tick)}
		<g class="tick" transform="translate(0, {$yScale(tick)})">
			<line x1="0" x2="-6" stroke="currentColor" />
			<text x="-9" dy="0.32em" fill="currentColor" text-anchor="end">
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
