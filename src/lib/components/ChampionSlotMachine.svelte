<script lang="ts">
	import { onMount } from 'svelte';
	import { getChampionIconUrl, getAllChampionIds } from '$lib/data-dragon';

	// Fallback champions if cache not ready
	const fallbackChampions = [
		'Yasuo', 'Ahri', 'Jinx', 'Zed', 'Lux', 'Thresh',
		'LeeSin', 'Akali', 'Ezreal', 'Katarina', 'Vayne', 'Jhin',
		'Riven', 'Draven', 'Teemo', 'Blitzcrank'
	];

	// Fisher-Yates shuffle algorithm
	function shuffleArray<T>(array: T[]): T[] {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}

	let champions = $state<string[]>([]);
	let extendedChampions = $derived([...champions, ...champions, ...champions]);

	let isSpinning = $state(false);
	let selectedIndex = $state(0);
	let highlightedChampion = $state<string | null>(null);
	let imageErrors = $state<Set<string>>(new Set());

	const iconSize = 96;
	const gapSize = 16;
	const itemWidth = iconSize + gapSize;

	let visualOffset = $derived.by(() => {
		// Keep the offset within the middle set of champions for seamless wrapping
		const wrappedIndex = ((selectedIndex % champions.length) + champions.length) % champions.length;
		return champions.length + wrappedIndex;
	});

	function getRandomIndex(): number {
		return Math.floor(Math.random() * champions.length);
	}

	function handleImageError(champion: string) {
		console.error(`Failed to load image for ${champion}:`, getChampionIconUrl(champion));
		imageErrors = new Set([...imageErrors, champion]);
	}

	function getChampionImageUrl(champion: string): string {
		const url = getChampionIconUrl(champion);
		return url;
	}

	async function spin() {
		if (isSpinning) return;

		isSpinning = true;
		highlightedChampion = null;

		const targetIndex = getRandomIndex();

		// Calculate positions to move (always forward)
		const currentChampionIndex = selectedIndex % champions.length;
		let positionsToMove = targetIndex - currentChampionIndex;
		if (positionsToMove < 0) positionsToMove += champions.length;
		
		// Add 2-3 full rotations for dramatic effect
		const fullRotations = 2 + Math.floor(Math.random() * 2);
		positionsToMove += fullRotations * champions.length;

		// Animate with easing for slot machine effect
		const startIndex = selectedIndex;
		const endIndex = startIndex + positionsToMove;
		const duration = 3000; // 3 seconds
		const startTime = Date.now();

		function animate() {
			const elapsed = Date.now() - startTime;
			const progress = Math.min(elapsed / duration, 1);
			
			// Cubic ease-out for slot machine deceleration
			const eased = 1 - Math.pow(1 - progress, 3);
			
			// Calculate current position
			const currentPosition = startIndex + (positionsToMove * eased);
			selectedIndex = currentPosition;

			if (progress < 1) {
				requestAnimationFrame(animate);
			} else {
				selectedIndex = endIndex;
				
				// Highlight the selected champion
				const championIndex = endIndex % champions.length;
				highlightedChampion = champions[championIndex];
				
				isSpinning = false;

				// Wait before next spin
				setTimeout(() => {
					spin();
				}, 4000);
			}
		}

		requestAnimationFrame(animate);
	}

	onMount(() => {
		// Get all champion IDs from Data Dragon cache
		const allChampionIds = getAllChampionIds();
		const championList = allChampionIds.length > 0 ? allChampionIds : fallbackChampions;

		champions = shuffleArray(championList);
		selectedIndex = champions.length; // Start in the middle set

		// Preload champion icons with error handling
		champions.forEach((champion) => {
			const img = new Image();
			img.src = getChampionIconUrl(champion);
			img.onerror = () => handleImageError(champion);
		});

		// Initial highlight
		const championIndex = selectedIndex % champions.length;
		highlightedChampion = champions[championIndex];

		// Start spinning after a delay
		setTimeout(() => {
			spin();
		}, 3000);
	});
</script>

<div class="flex flex-col items-center my-8">
	<div class="relative w-full max-w-[500px] px-4 sm:px-0">
		<!-- Slot machine frame (horizontal) -->
		<div class="relative w-full h-32 overflow-hidden rounded-2xl border-4 border-primary-500/60 bg-black/80 backdrop-blur-sm shadow-2xl shadow-primary-500/40">
			<!-- Left gradient fade -->
			<div class="absolute top-0 bottom-0 left-0 w-24 sm:w-32 bg-gradient-to-r from-black via-black/50 to-transparent z-10 pointer-events-none"></div>

			<!-- Right gradient fade -->
			<div class="absolute top-0 bottom-0 right-0 w-24 sm:w-32 bg-gradient-to-l from-black via-black/50 to-transparent z-10 pointer-events-none"></div>

			<!-- Center highlight box -->
			<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 border-2 border-primary-400 rounded-xl z-20 pointer-events-none {highlightedChampion && !isSpinning ? 'animate-pulse-glow shadow-2xl shadow-primary-500/80' : ''}"></div>

			<!-- Use visualOffset instead of selectedIndex for transform to keep champions visible -->
			<div
				class="absolute left-1/2 top-1/2 flex flex-row will-change-transform"
				style="
					gap: {gapSize}px;
					transform: translate(calc(-{visualOffset * itemWidth}px - {iconSize / 2}px), -50%);
					transition: {isSpinning ? 'none' : 'transform 0.3s ease-out'};
					{isSpinning ? 'filter: blur(4px);' : ''}
				"
			>
				{#each extendedChampions as champion, i (`${champion}-${i}`)}
					{@const isSelected = !isSpinning && Math.floor(visualOffset) === i}
					<div
						class="w-24 h-24 rounded-lg overflow-hidden border-2 transition-all duration-300 flex-shrink-0 bg-gray-900/50 transform-gpu {isSelected ? 'border-primary-400 scale-110 shadow-2xl shadow-primary-500' : 'border-gray-700/50'}"
						style="transform-origin: center center;"
					>
						{#if imageErrors.has(champion)}
							<!-- Fallback for failed images -->
							<div class="w-full h-full flex items-center justify-center bg-gray-800">
								<span class="text-primary-300 text-xs font-bold">{champion.slice(0, 3).toUpperCase()}</span>
							</div>
						{:else}
							<img
								src={getChampionImageUrl(champion) || "/placeholder.svg"}
								alt="Champion portrait of {champion}"
								class="w-full h-full object-cover {isSelected ? 'brightness-110' : 'brightness-75'}"
								onerror={() => handleImageError(champion)}
								loading="lazy"
							/>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>

	<!-- Fixed height container to prevent layout shift -->
	<div class="min-h-[60px] flex items-center justify-center mt-6">
		{#if highlightedChampion && !isSpinning}
			<div class="bg-primary-500/20 border-2 border-primary-400/60 rounded-lg px-6 py-3 backdrop-blur-sm animate-fade-in">
				<p class="text-primary-300 font-bold text-lg tracking-wider uppercase">{highlightedChampion}</p>
			</div>
		{/if}
	</div>
</div>

<style>
	@keyframes pulse-glow {
		0%, 100% {
			box-shadow: 0 0 20px rgba(196, 161, 91, 0.6);
		}
		50% {
			box-shadow: 0 0 40px rgba(196, 161, 91, 0.9);
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.animate-pulse-glow {
		animation: pulse-glow 2s ease-in-out infinite;
	}

	.animate-fade-in {
		animation: fade-in 0.3s ease-out;
	}
</style>
