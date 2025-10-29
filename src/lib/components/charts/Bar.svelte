<script lang="ts">
	import { getContext } from 'svelte';

	const { data, xGet, yGet, xScale, yScale, height } = getContext('LayerCake') as any;
</script>

<g class="bar-group">
	{#each $data as d, i (i)}
		<rect
			class="bar"
			x={$xGet(d)}
			y={$yGet(d)}
			width={$xScale.bandwidth()}
			height={$height - $yGet(d)}
			fill="var(--color-primary-500)"
			opacity="0.8"
		/>
	{/each}
</g>

<style>
	.bar {
		transition: opacity 0.2s ease;
	}

	.bar:hover {
		opacity: 1;
	}
</style>
