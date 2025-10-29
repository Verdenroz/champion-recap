<script lang="ts">
	import { getContext } from 'svelte';

	const { yScale } = getContext('LayerCake') as any;

	// Generate tick values (0, 20, 40, 60, 80, 100 for win rate percentages)
	let ticks = $derived($yScale.ticks ? $yScale.ticks(5) : []);
</script>

<g class="axis axis-y">
	{#each ticks as tick (tick)}
		<g class="tick tick-{tick}" transform="translate(0,{$yScale(tick)})">
			<line x2="-6" stroke="currentColor" />
			<text x="-9" dy="0.32em" fill="currentColor" text-anchor="end">
				{tick}%
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
