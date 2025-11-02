<script lang="ts">
	import { getChampionIconUrl } from '$lib/data-dragon';
	import TypewriterText from './TypewriterText.svelte';
	import VoicePlayer from './VoicePlayer.svelte';
	import type { CoachingObservation } from '$lib/hooks/useCoachingWebSocket';

	interface Props {
		observation: CoachingObservation;
		isStreaming?: boolean;
		streamingText?: string;
	}

	let { observation, isStreaming = false, streamingText = '' }: Props = $props();

	// Determine if this is a win or loss
	let isPositive = $derived(
		observation.text.toLowerCase().includes('win') ||
			observation.text.toLowerCase().includes('victory') ||
			observation.text.toLowerCase().includes('great') ||
			observation.text.toLowerCase().includes('excellent')
	);
</script>

<div
	class="card bg-gradient-to-br {isPositive
		? 'from-purple-900/30 to-black border-purple-700/30'
		: 'from-gray-900/50 to-black border-gray-700/30'} card-hover shadow-xl mb-6"
>
	<div class="card-body">
		<div class="flex items-start gap-4">
			<!-- Champion Avatar -->
			<div
				class="h-16 w-16 overflow-hidden rounded-xl border-3 {isPositive
					? 'border-purple-500'
					: 'border-gray-500'} shadow-lg flex-shrink-0"
			>
				<img
					src={getChampionIconUrl(observation.champion)}
					alt={observation.champion}
					width="64"
					height="64"
					class="object-cover"
				/>
			</div>

			<div class="flex-1">
				<!-- Match Number Badge -->
				<div class="mb-3 flex items-center gap-2">
					<span class="badge badge-primary badge-lg">Match #{observation.matchNumber}</span>
					<span class="text-sm text-gray-400">{observation.champion}</span>
				</div>

				<!-- Observation Text -->
				<div class="text-white leading-relaxed mb-4">
					{#if isStreaming}
						<TypewriterText text={streamingText} interval={20} cursor={true} />
					{:else}
						<TypewriterText text={observation.text} interval={15} cursor={false} />
					{/if}
				</div>

				<!-- Voice Player (if audio available) -->
				{#if !isStreaming && observation.audioUrl}
					<VoicePlayer
						audioUrl={observation.audioUrl}
						championName={observation.champion}
						compact={true}
					/>
				{/if}

				<!-- Streaming Indicator -->
				{#if isStreaming}
					<div class="flex items-center gap-2 text-sm text-gray-400 mt-2">
						<span class="loading loading-spinner loading-xs"></span>
						<span>Analyzing...</span>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
