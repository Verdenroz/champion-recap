<script lang="ts">
	import { onMount } from 'svelte';
	import { preloadStaticData } from '$lib/data-dragon';

	// Preload static data on component mount
	onMount(() => {
		preloadStaticData();
	});

	// Region configurations
	const regions = [
		{ platform: 'na1', region: 'americas', label: 'North America' },
		{ platform: 'euw1', region: 'europe', label: 'Europe West' },
		{ platform: 'eun1', region: 'europe', label: 'Europe Nordic & East' },
		{ platform: 'kr', region: 'asia', label: 'Korea' },
		{ platform: 'br1', region: 'americas', label: 'Brazil' },
		{ platform: 'la1', region: 'americas', label: 'Latin America North' },
		{ platform: 'la2', region: 'americas', label: 'Latin America South' },
		{ platform: 'jp1', region: 'asia', label: 'Japan' },
		{ platform: 'oc1', region: 'sea', label: 'Oceania' },
		{ platform: 'tr1', region: 'europe', label: 'Turkey' },
		{ platform: 'ru', region: 'europe', label: 'Russia' },
		{ platform: 'ph2', region: 'asia', label: 'Philippines' },
		{ platform: 'sg2', region: 'asia', label: 'Singapore' },
		{ platform: 'th2', region: 'asia', label: 'Thailand' },
		{ platform: 'tw2', region: 'asia', label: 'Taiwan' },
		{ platform: 'vn2', region: 'asia', label: 'Vietnam' }
	];

	let selectedRegion = $state('na1');
	let gameName = $state('');
	let tagLine = $state('');
	let error = $state<string | null>(null);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		// Navigate to the processing page with search params
		const regionConfig = regions.find((r) => r.platform === selectedRegion);
		if (!regionConfig) {
			error = 'Invalid region selected';
			return;
		}

		const params = new URLSearchParams({
			gameName,
			tagLine,
			platform: regionConfig.platform,
			region: regionConfig.region
		});

		window.location.href = `/recap?${params.toString()}`;
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4 sm:p-8">
	<div class="mx-auto max-w-6xl">
		<!-- Header -->
		<header class="mb-8 text-center">
			<h1 class="text-4xl font-bold text-white sm:text-5xl">
				League of Legends {new Date().getFullYear()} Recap
			</h1>
			<p class="mt-2 text-slate-300">
				View your complete League of Legends champion statistics for the year
			</p>
		</header>

		<!-- Search Form -->
		<div class="mb-8 rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
			<form onsubmit={handleSubmit} class="flex flex-col gap-4">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<div>
						<label for="region" class="mb-1 block text-sm font-medium text-slate-300">
							Region
						</label>
						<select
							id="region"
							bind:value={selectedRegion}
							class="w-full rounded-md border border-slate-600 bg-slate-700 px-4 py-2 text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
							{#each regions as regionOption}
								<option value={regionOption.platform}>{regionOption.label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="gameName" class="mb-1 block text-sm font-medium text-slate-300">
							Game Name
						</label>
						<input
							type="text"
							id="gameName"
							bind:value={gameName}
							placeholder="Game Name"
							required
							class="w-full rounded-md border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
						/>
					</div>
					<div>
						<label for="tagLine" class="mb-1 block text-sm font-medium text-slate-300">
							Tag Line
						</label>
						<input
							type="text"
							id="tagLine"
							bind:value={tagLine}
							placeholder="Tag Line (e.g., KR1)"
							required
							class="w-full rounded-md border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
						/>
					</div>
				</div>
				<div class="flex justify-center">
					<button
						type="submit"
						class="w-full rounded-md bg-blue-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-blue-700 sm:w-auto sm:px-12"
					>
						Generate Recap
					</button>
				</div>
			</form>
		</div>

		<!-- Error Message -->
		{#if error}
			<div class="mb-8 rounded-lg bg-red-900/50 p-4 text-red-200">
				<p class="font-semibold">Error:</p>
				<p>{error}</p>
			</div>
		{/if}

		<!-- Empty State -->
		{#if !error}
			<div class="text-center text-slate-400">
				<p>Enter a summoner name to generate your {new Date().getFullYear()} recap</p>
			</div>
		{/if}
	</div>
</div>
