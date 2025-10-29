<script lang="ts">
	import { LayerCake, Svg } from 'layercake';
	import { scaleLinear, scaleTime } from 'd3-scale';
	import { timeFormat } from 'd3-time-format';
	import Line from './charts/Line.svelte';
	import Area from './charts/Area.svelte';
	import AxisXTime from './charts/AxisXTime.svelte';
	import AxisYNumeric from './charts/AxisYNumeric.svelte';
	import type { MatchDto } from '$lib/types/riot';

	interface MatchTimelineChartProps {
		matches: MatchDto[];
		title?: string;
		year: number;
	}

	let { matches, title = 'Match Activity Over Time', year }: MatchTimelineChartProps = $props();

	interface TimelineDataPoint {
		x: Date;
		y: number;
	}

	// Transform matches into timeline data (matches per week)
	let chartData = $derived.by((): TimelineDataPoint[] => {
		if (!matches || matches.length === 0) return [];

		// Group matches by week
		const weeklyMatches = new Map<number, number>();

		for (const match of matches) {
			const date = new Date(match.info.gameCreation);
			const weekNumber = getWeekNumber(date);
			weeklyMatches.set(weekNumber, (weeklyMatches.get(weekNumber) || 0) + 1);
		}

		// Convert to array of data points
		const data: TimelineDataPoint[] = [];
		const startDate = new Date(year, 0, 1);
		const endDate = new Date(year, 11, 31);

		// Create data points for each week of the year
		for (let week = 0; week <= 52; week++) {
			const weekDate = new Date(startDate.getTime() + week * 7 * 24 * 60 * 60 * 1000);
			if (weekDate > endDate) break;

			data.push({
				x: weekDate,
				y: weeklyMatches.get(week) || 0
			});
		}

		return data;
	});

	function getWeekNumber(date: Date): number {
		const yearStart = new Date(date.getFullYear(), 0, 1);
		const diff = date.getTime() - yearStart.getTime();
		const oneWeek = 1000 * 60 * 60 * 24 * 7;
		return Math.floor(diff / oneWeek);
	}

	const xScale = scaleTime();
	const yScale = scaleLinear();
	const formatDate = timeFormat('%b');
</script>

<div class="match-timeline-chart">
	{#if title}
		<h3 class="text-xl font-bold text-white mb-4">{title}</h3>
	{/if}

	<div class="chart-container" style="height: 250px;">
		{#if chartData.length > 0}
			<LayerCake
				padding={{ top: 10, right: 15, bottom: 30, left: 40 }}
				x="x"
				y="y"
				xScale={xScale}
				yScale={yScale}
				data={chartData}
			>
				<Svg>
					<AxisXTime formatTick={formatDate} />
					<AxisYNumeric ticks={4} />
					<Area />
					<Line />
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
