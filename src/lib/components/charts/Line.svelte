<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';

	interface LayerCakeContext {
		data: Writable<Array<{ x: number; y: number }>>;
		xGet: Writable<(d: { x: number; y: number }) => number>;
		yGet: Writable<(d: { x: number; y: number }) => number>;
	}

	const { data, xGet, yGet } = getContext('LayerCake') as LayerCakeContext;

	let pathData = $derived.by(() => {
		const points = $data.map((d) => `${$xGet(d)},${$yGet(d)}`).join(' L');
		return points ? `M${points}` : '';
	});
</script>

<path
	class="line-path"
	d={pathData}
	fill="none"
	stroke="var(--color-primary-500)"
	stroke-width="2"
	stroke-linejoin="round"
	stroke-linecap="round"
/>

<style>
	.line-path {
		transition: stroke-width 0.2s ease;
	}
</style>
