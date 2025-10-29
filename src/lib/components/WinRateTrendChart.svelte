<script lang="ts">
	import { LayerCake, Svg } from 'layercake';
	import { scaleLinear, scaleTime } from 'd3-scale';
	import { timeFormat } from 'd3-time-format';
	import Line from './charts/Line.svelte';
	import AxisXTime from './charts/AxisXTime.svelte';
	import AxisYNumeric from './charts/AxisYNumeric.svelte';
	import type { MatchDto } from '$lib/types/riot';

	interface WinRateTrendChartProps {
		matches: MatchDto[];
		playerPuuid: string;
		title?: string;
		year: number;
	}

	let { matches, playerPuuid, title = 'Win Rate Trend', year }: WinRateTrendChartProps = $props();

	interface TrendDataPoint {
		x: Date;
		y: number;
	}

	// Calculate rolling win rate over time (30-day rolling average)
	let chartData = $derived.by((): TrendDataPoint[] => {
		if (!matches || matches.length === 0) return [];

		// Sort matches by date
		const sortedMatches = [...matches].sort(
			(a, b) => a.info.gameCreation - b.info.gameCreation
		);

		// Calculate win rate for each month
		const monthlyData = new Map<string, { wins: number; total: number }>();

		for (const match of sortedMatches) {
			const date = new Date(match.info.gameCreation);
			const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

			const player = match.info.participants.find((p) => p.puuid === playerPuuid);
			if (!player) continue;

			const monthData = monthlyData.get(monthKey) || { wins: 0, total: 0 };
			monthData.total++;
			if (player.win) monthData.wins++;
			monthlyData.set(monthKey, monthData);
		}

		// Convert to data points
		const data: TrendDataPoint[] = [];
		for (let month = 0; month < 12; month++) {
			const date = new Date(year, month, 1);
			const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
			const monthData = monthlyData.get(monthKey);

			if (monthData && monthData.total > 0) {
				data.push({
					x: date,
					y: (monthData.wins / monthData.total) * 100
				});
			}
		}

		return data;
	});

	const xScale = scaleTime();
	const yScale = scaleLinear().domain([0, 100]);
	const formatDate = timeFormat('%b');
	const formatPercent = (d: number) => `${Math.round(d)}%`;
</script>

<div class="win-rate-trend-chart">
	{#if title}
		<h3 class="text-xl font-bold text-white mb-4">{title}</h3>
	{/if}

	<div class="chart-container" style="height: 250px;">
		{#if chartData.length > 0}
			<LayerCake
				padding={{ top: 10, right: 15, bottom: 30, left: 50 }}
				x="x"
				y="y"
				xScale={xScale}
				yScale={yScale}
				data={chartData}
			>
				<Svg>
					<AxisXTime formatTick={formatDate} />
					<AxisYNumeric ticks={5} formatTick={formatPercent} />
					<Line />
					<!-- Reference line at 50% win rate -->
					<line
						x1="0"
						x2="100%"
						y1="50%"
						y2="50%"
						stroke="var(--color-gray-600)"
						stroke-width="1"
						stroke-dasharray="4 4"
						opacity="0.5"
					/>
				</Svg>
			</LayerCake>
		{:else}
			<div class="flex items-center justify-center h-full text-gray-500">
				No match data available
			</div>
		{/if}
	</div>
</div>

<style>
	.chart-container {
		width: 100%;
		position: relative;
	}
</style>
