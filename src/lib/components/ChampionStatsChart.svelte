<script lang="ts">
	import { LayerCake, Svg } from 'layercake';
	import { scaleLinear, scaleBand } from 'd3-scale';
	import Bar from './charts/Bar.svelte';
	import AxisX from './charts/AxisX.svelte';
	import AxisY from './charts/AxisY.svelte';

	interface ChampionStat {
		championName: string;
		gamesPlayed: number;
		wins: number;
		losses: number;
		winRate: number;
	}

	interface ChampionStatsChartProps {
		data: ChampionStat[];
		title?: string;
	}

	let { data, title = 'Champion Performance' }: ChampionStatsChartProps = $props();

	// Transform data for LayerCake
	let chartData = $derived(data.map(d => ({
		champion: d.championName,
		value: d.winRate * 100
	})));

	const xScale = scaleBand().paddingInner(0.05);
	const yScale = scaleLinear();
</script>

<div class="champion-stats-chart">
	{#if title}
		<h3 class="text-xl font-bold text-white mb-4">{title}</h3>
	{/if}

	<div class="chart-container" style="height: 300px;">
		<LayerCake
			padding={{ top: 10, right: 10, bottom: 30, left: 40 }}
			x="champion"
			y="value"
			xScale={xScale}
			yScale={yScale}
			data={chartData}
		>
			<Svg>
				<AxisX />
				<AxisY />
				<Bar />
			</Svg>
		</LayerCake>
	</div>
</div>

<style>
	.chart-container {
		width: 100%;
		position: relative;
	}
</style>
