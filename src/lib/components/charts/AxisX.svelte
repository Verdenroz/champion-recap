<script lang="ts">
	import { getContext } from 'svelte';

	const { width, height, xScale, xGet } = getContext('LayerCake') as any;
</script>

<g class="axis axis-x">
	{#each $xScale.domain() as tick (tick)}
		<g class="tick tick-{tick}" transform="translate({$xGet({ champion: tick })},{$height})">
			<line y1="0" y2="6" stroke="currentColor" />
			<text y="9" dy="0.71em" fill="currentColor" text-anchor="middle">
				{tick}
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
