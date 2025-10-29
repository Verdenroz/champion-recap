<script lang="ts">
	import { onMount } from 'svelte';
	import { preloadStaticData } from '$lib/data-dragon';
	import autoAnimate from '@formkit/auto-animate';
	import { createForm } from 'felte';
	import TypewriterText from '$lib/components/TypewriterText.svelte';
	import { useRecentRecaps } from '$lib/queries/recent-recaps';

	// Preload static data on component mount
	onMount(() => {
		preloadStaticData();
	});

	// Region configurations
	const regions = [
		{ value: 'na1', name: 'North America', region: 'americas' },
		{ value: 'euw1', name: 'Europe West', region: 'europe' },
		{ value: 'eun1', name: 'Europe Nordic & East', region: 'europe' },
		{ value: 'kr', name: 'Korea', region: 'asia' },
		{ value: 'br1', name: 'Brazil', region: 'americas' },
		{ value: 'la1', name: 'Latin America North', region: 'americas' },
		{ value: 'la2', name: 'Latin America South', region: 'americas' },
		{ value: 'jp1', name: 'Japan', region: 'asia' },
		{ value: 'oc1', name: 'Oceania', region: 'sea' },
		{ value: 'tr1', name: 'Turkey', region: 'europe' },
		{ value: 'ru', name: 'Russia', region: 'europe' },
		{ value: 'ph2', name: 'Philippines', region: 'asia' },
		{ value: 'sg2', name: 'Singapore', region: 'asia' },
		{ value: 'th2', name: 'Thailand', region: 'asia' },
		{ value: 'tw2', name: 'Taiwan', region: 'asia' },
		{ value: 'vn2', name: 'Vietnam', region: 'asia' }
	];

	let currentSlide = $state(0);
	let showWelcome = $state(false);

	// TanStack Query for recent recaps
	const recapsQuery = useRecentRecaps();

	// Felte form management
	const { form, errors, isSubmitting } = createForm({
		initialValues: {
			region: 'na1',
			gameName: '',
			tagLine: ''
		},
		validate: (values) => {
			const errors: Record<string, string> = {};

			if (!values.gameName || values.gameName.trim().length === 0) {
				errors.gameName = 'Game name is required';
			} else if (values.gameName.trim().length < 3) {
				errors.gameName = 'Game name must be at least 3 characters';
			}

			if (!values.tagLine || values.tagLine.trim().length === 0) {
				errors.tagLine = 'Tag line is required';
			} else if (values.tagLine.trim().length < 2) {
				errors.tagLine = 'Tag line must be at least 2 characters';
			}

			return errors;
		},
		onSubmit: (values) => {
			const regionConfig = regions.find((r) => r.value === values.region);
			if (!regionConfig) {
				return;
			}

			const params = new URLSearchParams({
				gameName: values.gameName.trim(),
				tagLine: values.tagLine.trim(),
				platform: regionConfig.value,
				region: regionConfig.region
			});

			window.location.href = `/recap?${params.toString()}`;
		}
	});

	// Derived state from TanStack Query
	let recentRecaps = $derived(recapsQuery.data || []);
	let recapsLoading = $derived(recapsQuery.isLoading);
	let recapsError = $derived(recapsQuery.isError);

	// Auto-scroll state
	let isCarouselPaused = $state(false);
	let autoScrollInterval: ReturnType<typeof setInterval> | null = null;

	function nextSlide() {
		currentSlide = (currentSlide + 1) % Math.ceil(recentRecaps.length / 3);
	}

	function prevSlide() {
		currentSlide = currentSlide === 0 ? Math.ceil(recentRecaps.length / 3) - 1 : currentSlide - 1;
	}

	function handleManualNavigation(direction: 'next' | 'prev') {
		// Pause auto-scroll temporarily when user manually navigates
		isCarouselPaused = true;

		// Navigate
		if (direction === 'next') {
			nextSlide();
		} else {
			prevSlide();
		}

		// Resume auto-scroll after 10 seconds
		setTimeout(() => {
			isCarouselPaused = false;
		}, 10000);
	}

	// Auto-scroll carousel
	$effect(() => {
		// Only auto-scroll if we have recaps and not loading/error
		if (!recapsLoading && !recapsError && recentRecaps.length > 3 && !isCarouselPaused) {
			// Clear any existing interval
			if (autoScrollInterval) {
				clearInterval(autoScrollInterval);
			}

			// Auto-advance every 4 seconds
			autoScrollInterval = setInterval(() => {
				nextSlide();
			}, 4000);

			// Cleanup on effect re-run or component unmount
			return () => {
				if (autoScrollInterval) {
					clearInterval(autoScrollInterval);
				}
			};
		}
	});

	// Show welcome message after mount
	onMount(() => {
		setTimeout(() => {
			showWelcome = true;
		}, 500);
	});

	// Refs for AutoAnimate
	let errorContainerRef: HTMLDivElement | null = null;

	$effect(() => {
		if (errorContainerRef) {
			autoAnimate(errorContainerRef);
		}
	});
</script>

<div class="min-h-screen animated-bg p-4 sm:p-8">
	<div class="mx-auto max-w-4xl">
		<!-- Header -->
		<header class="mb-12 text-center pt-16 relative z-10">
			<!-- League Gold Badge with angled shape -->
			<div class="inline-block mb-4 px-6 py-2 bg-primary-500/15 border-2 border-primary-500/40 rounded-lg relative overflow-hidden">
				<div class="absolute inset-0 bg-gradient-to-r from-primary-500/0 via-primary-500/10 to-primary-500/0"></div>
				{#if showWelcome}
					<TypewriterText
						text="GLHF SUMMONER"
						interval={40}
						cursor={false}
					/>
				{:else}
					<span class="text-primary-400 text-sm font-bold tracking-widest uppercase" style="font-family: 'Montserrat', sans-serif;">GLHF SUMMONER</span>
				{/if}
			</div>
			<!-- Main Title with Bold Typography -->
			<h1 class="text-5xl sm:text-7xl font-black text-white mb-4 tracking-tight" style="font-family: 'Montserrat', sans-serif; font-weight: 900;">
				Champion <span class="gradient-text">Recap</span>
			</h1>
			<p class="text-xl text-gray-400 font-medium mb-2">
				Your League of Legends {new Date().getFullYear()} Year in Review
			</p>
			{#if showWelcome}
				<div class="text-md text-primary-300/90 font-semibold">
					<TypewriterText
						text="Discover your champion stats, nemesis picks & epic plays"
						interval={30}
						cursor={false}
					/>
				</div>
			{:else}
				<p class="text-md text-primary-300/90 font-semibold">
					Discover your champion stats, nemesis picks & epic plays
				</p>
			{/if}
			<!-- Gold Divider with glow -->
			<div class="mt-6 h-1 w-32 mx-auto bg-gradient-to-r from-transparent via-primary-400 to-transparent rounded-full pulse-glow shadow-lg shadow-primary-500/30"></div>
		</header>

		<!-- Search Form -->
		<div class="card bg-black/60 backdrop-blur-xl border-gray-800/50 card-hover shadow-xl mb-8">
			<div class="card-body">
				<form use:form class="flex flex-col gap-6">
					<div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
						<div class="flex flex-col">
							<label for="region" class="label">
								<span class="label-text mb-2 text-sm font-semibold text-gray-300 uppercase tracking-wide">
									Region
								</span>
							</label>
							<select
								id="region"
								name="region"
								class="select select-bordered border-2 border-gray-700/50 bg-black/40 text-white focus:border-primary-500 focus:ring-primary-500 hover:border-gray-600"
							>
								{#each regions as region (region.value)}
									<option value={region.value}>{region.name}</option>
								{/each}
							</select>
						</div>
						<div class="flex flex-col">
							<label for="gameName" class="label">
								<span class="label-text mb-2 text-sm font-semibold text-gray-300 uppercase tracking-wide">
									Game Name
								</span>
							</label>
							<input
								type="text"
								id="gameName"
								name="gameName"
								placeholder="Faker"
								class="input input-bordered border-2 border-gray-700/50 bg-black/40 text-white placeholder-gray-500 focus:border-primary-500 focus:ring-primary-500 hover:border-gray-600 {$errors.gameName ? 'border-red-500' : ''}"
							/>
							<div bind:this={errorContainerRef}>
								{#if $errors.gameName}
									<p class="text-red-400 text-xs mt-1">{$errors.gameName}</p>
								{/if}
							</div>
						</div>
						<div class="flex flex-col">
							<label for="tagLine" class="label">
								<span class="label-text mb-2 text-sm font-semibold text-gray-300 uppercase tracking-wide">
									Tag Line
								</span>
							</label>
							<input
								type="text"
								id="tagLine"
								name="tagLine"
								placeholder="NA1"
								class="input input-bordered border-2 border-gray-700/50 bg-black/40 text-white placeholder-gray-500 focus:border-primary-500 focus:ring-primary-500 hover:border-gray-600 {$errors.tagLine ? 'border-red-500' : ''}"
							/>
							{#if $errors.tagLine}
								<p class="text-red-400 text-xs mt-1">{$errors.tagLine}</p>
							{/if}
						</div>
					</div>
					<div class="flex justify-center mt-4">
						<button
							type="submit"
							disabled={$isSubmitting}
							class="btn btn-primary btn-lg w-full sm:w-auto px-12 py-4 bg-primary-500 hover:bg-primary-600 focus:ring-4 focus:ring-primary-400/50 font-black text-lg rounded-xl transition-all duration-300 hover:shadow-2xl hover:shadow-primary-500/60 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-black border-2 border-primary-400"
							style="font-family: 'Montserrat', sans-serif; text-shadow: 0 1px 2px rgba(0,0,0,0.2);"
						>
							{#if $isSubmitting}
								<TypewriterText text="Processing..." interval={50} cursor={false} />
							{:else}
								Generate Your Recap
							{/if}
						</button>
					</div>
				</form>
			</div>
		</div>

		<!-- Recent Recaps Carousel -->
		<div class="mt-16 mb-12 relative z-10">
			<div class="flex items-center justify-between mb-6">
				<h2 class="text-2xl sm:text-3xl font-black text-white" style="font-family: 'Montserrat', sans-serif;">
					Recent <span class="gradient-text">Recaps</span>
				</h2>
				{#if !recapsLoading && recentRecaps.length > 3}
					<div class="flex gap-2">
						<button
							onclick={() => handleManualNavigation('prev')}
							class="btn btn-square btn-ghost bg-black/40 border-2 border-gray-700/50 hover:border-primary-400 hover:bg-primary-500/15 transition-all"
							aria-label="Previous slide"
						>
							<span class="iconify lucide--chevron-left text-gray-400 hover:text-primary-400"></span>
						</button>
						<button
							onclick={() => handleManualNavigation('next')}
							class="btn btn-square btn-ghost bg-black/40 border-2 border-gray-700/50 hover:border-primary-400 hover:bg-primary-500/15 transition-all"
							aria-label="Next slide"
						>
							<span class="iconify lucide--chevron-right text-gray-400 hover:text-primary-400"></span>
						</button>
					</div>
				{/if}
			</div>

			{#if recapsLoading}
				<!-- Loading State -->
				<div class="card bg-black/40 backdrop-blur-sm border-gray-800/50 shadow-lg py-12">
					<div class="card-body flex flex-col items-center gap-4">
						<span class="loading loading-spinner loading-lg text-primary-500"></span>
						<p class="text-gray-400 text-sm">Loading recent recaps...</p>
					</div>
				</div>
			{:else if recapsError}
				<!-- Error State -->
				<div class="card bg-black/40 backdrop-blur-sm border-red-800/50 shadow-lg py-8">
					<div class="card-body flex flex-col items-center gap-4">
						<span class="iconify lucide--alert-circle text-red-500 w-12 h-12"></span>
						<p class="text-red-400 text-sm">Failed to load recent recaps</p>
						<button
							onclick={() => recapsQuery.refetch()}
							class="btn btn-sm btn-outline btn-primary"
						>
							Retry
						</button>
					</div>
				</div>
			{:else if recentRecaps.length === 0}
				<!-- Empty State -->
				<div class="card bg-black/40 backdrop-blur-sm border-gray-800/50 shadow-lg py-12">
					<div class="card-body flex flex-col items-center gap-4">
						<span class="iconify lucide--inbox text-gray-600 w-16 h-16"></span>
						<p class="text-gray-400 text-sm">No recaps yet. Be the first to generate one!</p>
					</div>
				</div>
			{:else}
				<!-- Carousel -->
				<div
					class="overflow-hidden"
					role="region"
					aria-label="Recent recaps carousel"
					onmouseenter={() => isCarouselPaused = true}
					onmouseleave={() => isCarouselPaused = false}
				>
					<div
						use:autoAnimate
						class="flex transition-transform duration-500 ease-out gap-4"
						style="transform: translateX(-{currentSlide * 100}%)"
					>
						{#each recentRecaps as recap (recap.puuid)}
							<div class="min-w-[calc(33.333%-0.67rem)] flex-shrink-0">
								<div class="card bg-black/40 backdrop-blur-sm border-gray-800/50 card-hover shadow-lg h-full">
									<div class="card-body">
										<div class="flex items-start justify-between mb-3">
											<div>
												<h3 class="text-lg font-bold text-white">{recap.gameName}<span class="text-gray-500">#{recap.tagLine}</span></h3>
											</div>
											{#if recap.status === 'completed'}
												<span class="badge badge-primary gap-1 bg-primary-500/20 text-primary-300 border border-primary-500/40 font-semibold">
													<span class="iconify lucide--check-circle w-3 h-3"></span>
													Complete
												</span>
											{:else}
												<span class="badge badge-warning gap-1 bg-primary-500/20 text-primary-400 border border-primary-500/40 font-semibold">
													<span class="iconify lucide--clock w-3 h-3"></span>
													Processing
												</span>
											{/if}
										</div>

										{#if recap.status === 'completed'}
											<div class="mt-4 pt-4 border-t border-gray-800">
												<div class="flex items-center justify-between">
													{#if recap.topChampion}
														<div>
															<p class="text-xs text-gray-500 uppercase tracking-wider font-semibold">Top Champion</p>
															<p class="text-sm font-bold text-primary-300">{recap.topChampion}</p>
														</div>
													{/if}
													{#if recap.matches}
														<div class="text-right">
															<p class="text-xs text-gray-500 uppercase tracking-wide">Matches</p>
															<p class="text-sm font-semibold text-white">{recap.matches}</p>
														</div>
													{/if}
												</div>
											</div>
										{:else if recap.progress !== undefined}
											<div class="mt-4 pt-4 border-t border-gray-800">
												<div class="flex items-center justify-between mb-2">
													<span class="text-xs text-gray-500 uppercase tracking-wider font-semibold">Progress</span>
													<span class="text-xs font-bold text-primary-300">{recap.progress}%</span>
												</div>
												<progress class="progress progress-warning bg-gray-800/50" value={recap.progress} max="100" style="--progress-color: #c4a15b;"></progress>
											</div>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Slide Indicators -->
				{#if recentRecaps.length > 3}
					<div class="flex justify-center gap-2 mt-6">
						{#each Array(Math.ceil(recentRecaps.length / 3)) as _, i (i)}
							<button
								onclick={() => currentSlide = i}
								class="h-2 rounded-full transition-all duration-300 {currentSlide === i ? 'bg-primary-400 w-8 shadow-lg shadow-primary-500/40' : 'bg-gray-700 w-2 hover:bg-gray-600'}"
								aria-label="Go to slide {i + 1}"
							></button>
						{/each}
					</div>
				{/if}
			{/if}
		</div>

		<!-- Footer -->
		<footer class="mt-8 text-center text-gray-600 text-xs pb-8 relative z-10">
			<div class="flex items-center justify-center gap-2 mb-3">
				<span class="iconify lucide--pie-chart w-4 h-4 text-primary-400/60"></span>
				<span class="font-semibold text-gray-500">Powered by</span>
				<span class="text-primary-300 font-bold">Riot Games API</span>
				<span class="text-gray-600">•</span>
				<span class="text-primary-300 font-bold">AWS Serverless</span>
			</div>
			<p class="text-gray-700 max-w-2xl mx-auto">
				League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
			</p>
			<p class="text-gray-800 mt-2">
				Champion Recap isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.
			</p>
		</footer>
	</div>
</div>
