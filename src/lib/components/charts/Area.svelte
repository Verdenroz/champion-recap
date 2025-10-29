<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';

	interface LayerCakeContext {
		data: Writable<Array<{ x: number; y: number }>>;
		xGet: Writable<(d: { x: number; y: number }) => number>;
		yGet: Writable<(d: { x: number; y: number }) => number>;
		height: Writable<number>;
	}

	const { data, xGet, yGet, height } = getContext('LayerCake') as LayerCakeContext;

	let pathData = $derived.by(() => {
		if ($data.length === 0) return '';

		const firstPoint = `M${$xGet($data[0])},${$height}`;
		const linePoints = $data.map((d) => `L${$xGet(d)},${$yGet(d)}`).join(' ');
		const lastPoint = `L${$xGet($data[$data.length - 1])},${$height}`;
		const closePath = 'Z';

		return `${firstPoint} ${linePoints} ${lastPoint} ${closePath}`;
	});
</script>

<path
	class="area-path"
	d={pathData}
	fill="var(--color-primary-500)"
	opacity="0.2"
/>

<style>
	.area-path {
		transition: opacity 0.2s ease;
	}
</style>
