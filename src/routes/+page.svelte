<script lang="ts">
	import { onMount } from 'svelte';
	import { preloadStaticData } from '$lib/data-dragon';
	import autoAnimate from '@formkit/auto-animate';
	import { createForm } from 'felte';
	import TypewriterText from '$lib/components/TypewriterText.svelte';
	import ChampionSlotMachine from '$lib/components/ChampionSlotMachine.svelte';
	import { useRecentRecaps } from '$lib/queries/recent-recaps';

	const recapsQuery = useRecentRecaps();
	let recentRecaps = $derived(recapsQuery.data || []);
	let recapsLoading = $derived(recapsQuery.isLoading);
	let recapsError = $derived(recapsQuery.isError);

	// Region configurations
	const regions = [
		{ value: 'na1', name: 'North America', abbr: 'NA', region: 'americas' },
		{ value: 'euw1', name: 'Europe West', abbr: 'EUW', region: 'europe' },
		{ value: 'eun1', name: 'Europe Nordic & East', abbr: 'EUNE', region: 'europe' },
		{ value: 'kr', name: 'Korea', abbr: 'KR', region: 'asia' },
		{ value: 'br1', name: 'Brazil', abbr: 'BR', region: 'americas' },
		{ value: 'la1', name: 'Latin America North', abbr: 'LAN', region: 'americas' },
		{ value: 'la2', name: 'Latin America South', abbr: 'LAS', region: 'americas' },
		{ value: 'jp1', name: 'Japan', abbr: 'JP', region: 'asia' },
		{ value: 'oc1', name: 'Oceania', abbr: 'OCE', region: 'sea' },
		{ value: 'tr1', name: 'Turkey', abbr: 'TR', region: 'europe' },
		{ value: 'ru', name: 'Russia', abbr: 'RU', region: 'europe' },
		{ value: 'ph2', name: 'Philippines', abbr: 'PH', region: 'asia' },
		{ value: 'sg2', name: 'Singapore', abbr: 'SG', region: 'asia' },
		{ value: 'th2', name: 'Thailand', abbr: 'TH', region: 'asia' },
		{ value: 'tw2', name: 'Taiwan', abbr: 'TW', region: 'asia' },
		{ value: 'vn2', name: 'Vietnam', abbr: 'VN', region: 'asia' }
	];

	let summonerInput = $state('');

	// Felte form management
	const { form, errors, isSubmitting, setFields } = createForm({
		initialValues: {
			region: 'na1',
			gameName: '',
			tagLine: '',
			summonerInput: ''
		},
		validate: (values) => {
			const errors: Record<string, string> = {};

			if (!values.gameName || values.gameName.trim().length === 0) {
				errors.summonerInput = 'Summoner name is required';
			} else if (values.gameName.trim().length < 3) {
				errors.summonerInput = 'Game name must be at least 3 characters';
			}

			if (!values.tagLine || values.tagLine.trim().length === 0) {
				errors.summonerInput = 'Tag line is required';
			} else if (values.tagLine.trim().length < 2) {
				errors.summonerInput = 'Tag line must be at least 2 characters';
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

	let currentSlide = $state(0);
	let showWelcome = $state(false);
	let isCarouselPaused = $state(false);
	let autoScrollInterval = $state<ReturnType<typeof setInterval> | null>(null);
	let errorContainerRef = $state<HTMLDivElement | null>(null);

	function nextSlide() {
		currentSlide = (currentSlide + 1) % Math.ceil(recentRecaps.length / 3);
	}

	function prevSlide() {
		currentSlide = currentSlide === 0 ? Math.ceil(recentRecaps.length / 3) - 1 : currentSlide - 1;
	}

	function handleManualNavigation(direction: 'next' | 'prev') {
		isCarouselPaused = true;

		if (direction === 'next') {
			nextSlide();
		} else {
			prevSlide();
		}

		setTimeout(() => {
			isCarouselPaused = false;
		}, 10000);
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			const formElement = event.target as HTMLElement;
			const form = formElement.closest('form');
			if (form) {
				form.requestSubmit();
			}
		}
	}

	function handleSummonerInput(value: string) {
		const parts = value.split('#');
		if (parts.length === 2) {
			setFields('gameName', parts[0]);
			setFields('tagLine', parts[1]);
		} else if (parts.length === 1) {
			setFields('gameName', parts[0]);
			setFields('tagLine', '');
		}
	}

	let autoScrollIntervalCleanup: () => void;

	$effect(() => {
		if (errorContainerRef) {
			autoAnimate(errorContainerRef);
		}
	});

	$effect(() => {
		handleSummonerInput(summonerInput);
	});

	$effect(() => {
		if (!recapsLoading && !recapsError && recentRecaps.length > 3 && !isCarouselPaused) {
			if (autoScrollInterval) {
				autoScrollIntervalCleanup();
			}

			autoScrollInterval = setInterval(() => {
				currentSlide = (currentSlide + 1) % Math.ceil(recentRecaps.length / 3);
			}, 4000);

			autoScrollIntervalCleanup = () => {
				if (autoScrollInterval) {
					clearInterval(autoScrollInterval);
					autoScrollInterval = null;
				}
			};

			return () => {
				autoScrollIntervalCleanup();
			};
		}
	});

	onMount(() => {
		preloadStaticData();
		setTimeout(() => {
			showWelcome = true;
		}, 500);
	});
</script>

<div class="min-h-screen p-4 sm:p-8 relative">
	<div class="mx-auto max-w-4xl">
		<header class="mb-12 text-center pt-16 relative z-10">
			<h1 class="text-6xl sm:text-8xl font-black text-white mb-6 tracking-tight drop-shadow-2xl" style="font-family: 'Montserrat', sans-serif; font-weight: 900; text-shadow: 0 0 40px rgba(196, 161, 91, 0.5), 0 0 80px rgba(196, 161, 91, 0.3);">
				Champion <span class="gradient-text animate-pulse-glow">Recap</span>
			</h1>
			
			<p class="text-2xl text-gray-300 font-bold mb-3 drop-shadow-lg">
				Your League of Legends {new Date().getFullYear()} Year in Review
			</p>
			
			{#if showWelcome}
				<div class="text-lg text-primary-300/90 font-semibold drop-shadow-md">
					<TypewriterText
						text="Discover your champion stats, nemesis picks & epic plays"
						interval={30}
						cursor={false}
					/>
				</div>
			{:else}
				<p class="text-lg text-primary-300/90 font-semibold drop-shadow-md">
					Discover your champion stats, nemesis picks & epic plays
				</p>
			{/if}

			<div class="mt-8 h-1 w-40 mx-auto bg-gradient-to-r from-transparent via-primary-400 to-transparent rounded-full shadow-2xl shadow-primary-500/60 animate-pulse-glow"></div>
		</header>

		<!-- Champion Slot Machine -->
		<ChampionSlotMachine />

		<!-- Search Bar -->
		<div class="mb-16 relative z-10 max-w-4xl mx-auto">
			<form use:form class="flex flex-col gap-6">
				<!-- Unified Search Bar -->
				<div class="flex items-stretch rounded-full bg-black/60 backdrop-blur-xl border-2 border-primary-500/30 hover:border-primary-400/50 has-[:focus]:border-primary-400 has-[:focus]:shadow-xl has-[:focus]:shadow-primary-500/60 hover:shadow-lg hover:shadow-primary-500/30 transition-all duration-300 overflow-hidden">
					<!-- Region Dropdown -->
					<div class="relative flex-shrink-0 border-r border-primary-500/20">
						<select
							id="region"
							name="region"
							class="h-full pl-8 pr-12 py-7 text-lg font-bold bg-transparent text-white hover:bg-primary-500/10 focus:outline-none focus:ring-0 transition-all duration-300 cursor-pointer appearance-none"
							onkeypress={handleKeyPress}
						>
							{#each regions as region (region.value)}
								<option value={region.value}>{region.abbr}</option>
							{/each}
						</select>
						<span class="icon-[tabler--chevron-down] absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary-400 pointer-events-none"></span>
					</div>

					<!-- Combined Summoner Input -->
					<div class="flex-1 flex items-center gap-4 min-w-0">
						<input
							type="text"
							id="summonerInput"
							bind:value={summonerInput}
							placeholder="Enter Summoner Name#TAG"
							onkeypress={handleKeyPress}
							class="flex-1 min-w-0 bg-transparent text-lg text-white placeholder-gray-500 focus:outline-none focus:ring-0 border-none py-7 px-4"
						/>
						<button
							type="submit"
							class="h-full hidden sm:flex items-center text-gray-500 hover:text-primary-400 text-sm font-medium shrink-0 px-4 transition-colors duration-200 cursor-pointer"
						>
							<span class="whitespace-nowrap">Press Enter</span>
						</button>
					</div>
				</div>

				<!-- Error Display -->
				<div bind:this={errorContainerRef} class="min-h-[28px]">
					{#if $errors.summonerInput}
						<p class="text-red-400 text-base font-semibold flex items-center gap-2 justify-center">
							<span class="icon-[tabler--alert-circle] size-5"></span>
							{$errors.summonerInput}
						</p>
					{/if}
				</div>
			</form>
		</div>

		<div class="mt-16 mb-12 relative z-10">
			<div class="flex items-center justify-center mb-8 relative">
				<h2 class="text-3xl sm:text-4xl font-black text-white drop-shadow-lg text-center" style="font-family: 'Montserrat', sans-serif;">
					Recent <span class="gradient-text">Recaps</span>
				</h2>
				{#if !recapsLoading && recentRecaps.length > 3}
					<div class="absolute right-0 flex gap-3">
						<button
							onclick={() => handleManualNavigation('prev')}
							class="btn btn-square btn-ghost bg-black/60 border-2 border-gray-600/60 hover:border-primary-400 hover:bg-primary-500/20 transition-all backdrop-blur-sm hover:scale-110"
							aria-label="Previous slide"
						>
							<span class="iconify lucide--chevron-left text-gray-300 hover:text-primary-400 w-6 h-6"></span>
						</button>
						<button
							onclick={() => handleManualNavigation('next')}
							class="btn btn-square btn-ghost bg-black/60 border-2 border-gray-600/60 hover:border-primary-400 hover:bg-primary-500/20 transition-all backdrop-blur-sm hover:scale-110"
							aria-label="Next slide"
						>
							<span class="iconify lucide--chevron-right text-gray-300 hover:text-primary-400 w-6 h-6"></span>
						</button>
					</div>
				{/if}
			</div>

			{#if recapsLoading}
				<div class="card bg-black/60 backdrop-blur-xl border-2 border-gray-700/60 shadow-2xl py-16">
					<div class="card-body flex flex-col items-center gap-6">
						<span class="loading loading-spinner loading-lg text-primary-500"></span>
						<p class="text-gray-300 text-base font-semibold">Loading recent recaps...</p>
					</div>
				</div>
			{:else if recapsError}
				<div class="card bg-black/60 backdrop-blur-xl border-2 border-red-800/60 shadow-2xl py-12">
					<div class="card-body flex flex-col items-center gap-4">
						<span class="iconify lucide--alert-circle text-red-500 w-12 h-12"></span>
						<p class="text-red-400 text-base font-semibold">Failed to load recent recaps</p>
						<button
							onclick={() => recapsQuery.refetch()}
							class="btn btn-sm btn-outline btn-primary hover:scale-105 transition-transform"
						>
							Retry
						</button>
					</div>
				</div>
			{:else if recentRecaps.length === 0}
				<div class="card bg-black/60 backdrop-blur-xl border-2 border-gray-700/60 shadow-2xl py-16">
					<div class="card-body flex flex-col items-center gap-6">
						<span class="iconify lucide--inbox text-gray-500 w-20 h-20"></span>
						<p class="text-gray-300 text-base font-semibold">No recaps yet. Be the first to generate one!</p>
					</div>
				</div>
			{:else}
				<div
					class="overflow-hidden"
					role="region"
					aria-label="Recent recaps carousel"
					onmouseenter={() => isCarouselPaused = true}
					onmouseleave={() => isCarouselPaused = false}
				>
					<div
						class="flex transition-transform duration-500 ease-out gap-6"
						style="transform: translateX(-{currentSlide * 100}%)"
					>
						{#each recentRecaps as recap (recap.puuid)}
							<div class="min-w-[calc(33.333%-1rem)] flex-shrink-0">
								<div class="card bg-black/60 backdrop-blur-xl border-2 border-gray-700/60 hover:border-primary-500/60 card-hover shadow-xl hover:shadow-2xl hover:shadow-primary-500/30 h-full transition-all duration-300">
									<div class="card-body">
										<div class="flex items-start justify-between mb-3">
											<div>
												<h3 class="text-lg font-bold text-white">{recap.gameName}<span class="text-gray-400">#{recap.tagLine}</span></h3>
											</div>
											{#if recap.status === 'completed'}
												<span class="badge badge-primary gap-1 bg-primary-500/30 text-primary-200 border-2 border-primary-400/60 font-bold px-3 py-2">
													<span class="iconify lucide--check-circle w-4 h-4"></span>
													Complete
												</span>
											{:else}
												<span class="badge badge-warning gap-1 bg-primary-500/30 text-primary-300 border-2 border-primary-400/60 font-bold px-3 py-2">
													<span class="iconify lucide--clock w-4 h-4"></span>
													Processing
												</span>
											{/if}
										</div>

										{#if recap.status === 'completed'}
											<div class="mt-4 pt-4 border-t border-gray-700/60">
												<div class="flex items-center justify-between">
													{#if recap.topChampion}
														<div>
															<p class="text-xs text-gray-400 uppercase tracking-wider font-bold">Top Champion</p>
															<p class="text-base font-bold text-primary-300">{recap.topChampion}</p>
														</div>
													{/if}
													{#if recap.matches}
														<div class="text-right">
															<p class="text-xs text-gray-400 uppercase tracking-wider font-bold">Matches</p>
															<p class="text-base font-bold text-white">{recap.matches}</p>
														</div>
													{/if}
												</div>
											</div>
										{:else if recap.progress !== undefined}
											<div class="mt-4 pt-4 border-t border-gray-700/60">
												<div class="flex items-center justify-between mb-2">
													<span class="text-xs text-gray-400 uppercase tracking-wider font-bold">Progress</span>
													<span class="text-xs font-bold text-primary-300">{recap.progress}%</span>
												</div>
												<progress class="progress progress-warning bg-gray-800/60" value={recap.progress} max="100" style="--progress-color: #c4a15b;"></progress>
											</div>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				{#if recentRecaps.length > 3}
					<div class="flex justify-center gap-3 mt-8">
						{#each Array(Math.ceil(recentRecaps.length / 3)) as _, i (i)}
							<button
								onclick={() => currentSlide = i}
								class="h-2 rounded-full transition-all duration-300 {currentSlide === i ? 'bg-primary-400 w-10 shadow-lg shadow-primary-500/60' : 'bg-gray-600 w-2 hover:bg-gray-500'}"
								aria-label="Go to slide {i + 1}"
							></button>
						{/each}
					</div>
				{/if}
			{/if}
		</div>

		<footer class="mt-12 text-center text-gray-500 text-xs pb-8 relative z-10">
			<div class="flex items-center justify-center gap-3 mb-4">
				<span class="iconify lucide--pie-chart w-5 h-5 text-primary-400/70"></span>
				<span class="font-bold text-gray-400">Powered by</span>
				<span class="text-primary-300 font-black">Riot Games API</span>
				<span class="text-gray-600">•</span>
				<span class="text-primary-300 font-black">AWS Serverless</span>
			</div>
			<p class="text-gray-600 max-w-2xl mx-auto leading-relaxed">
				League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
			</p>
			<p class="text-gray-700 mt-2 leading-relaxed">
				Champion Recap isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.
			</p>
		</footer>
	</div>
</div>
