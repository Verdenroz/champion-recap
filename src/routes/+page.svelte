<script lang="ts">
	import { onMount } from 'svelte';
	import { getChampionIconUrl, preloadStaticData } from '$lib/data-dragon';

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
	let loading = $state(false);
	let loadingProgress = $state('');
	let error = $state<string | null>(null);
	let recapData = $state<any>(null);
	let accountData = $state<any>(null);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		error = null;
		recapData = null;
		accountData = null;
		loadingProgress = 'Initiating processing...';

		await handleProgressiveLoad();
	}

	async function handleProgressiveLoad() {
		try {
			const regionConfig = regions.find((r) => r.platform === selectedRegion);
			if (!regionConfig) {
				throw new Error('Invalid region selected');
			}

			const eventSource = new EventSource(
				`/api/player/stream?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}&platform=${regionConfig.platform}&region=${regionConfig.region}`
			);

			eventSource.onmessage = (event) => {
				try {
					const chunk = JSON.parse(event.data);

					switch (chunk.type) {
						case 'status':
							loadingProgress = chunk.message;
							if (chunk.puuid) {
								accountData = { puuid: chunk.puuid };
							}
							break;

						case 'player_info':
							accountData = chunk.account;
							loadingProgress = 'Fetching player information...';
							break;

						case 'progress':
							loadingProgress = chunk.message;
							break;

						case 'partial':
							// Progressive data update - show partial results
							recapData = chunk.data;
							loadingProgress = 'Processing matches... Data updating in real-time!';
							break;

						case 'complete':
							recapData = chunk.data;
							loadingProgress = 'Complete!';
							loading = false;
							eventSource.close();
							break;

						case 'error':
							throw new Error(chunk.error);
					}
				} catch (err) {
					error = err instanceof Error ? err.message : 'Failed to parse stream data';
					eventSource.close();
					loading = false;
				}
			};

			eventSource.onerror = () => {
				error = 'Connection to server lost';
				eventSource.close();
				loading = false;
			};
		} catch (err) {
			error = err instanceof Error ? err.message : 'An error occurred';
			loading = false;
		}
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
						disabled={loading}
						class="w-full rounded-md bg-blue-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-slate-600 sm:w-auto sm:px-12"
					>
						{loading ? 'Loading...' : 'Generate Recap'}
					</button>
				</div>
			</form>
			{#if loadingProgress}
				<div class="mt-4">
					<p class="text-center text-sm text-slate-400">{loadingProgress}</p>
					<div class="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-700">
						<div
							class="h-full animate-pulse bg-blue-600"
							style="width: {loading ? '100%' : '0%'}"
						></div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Error Message -->
		{#if error}
			<div class="mb-8 rounded-lg bg-red-900/50 p-4 text-red-200">
				<p class="font-semibold">Error:</p>
				<p>{error}</p>
			</div>
		{/if}

		<!-- Recap Data -->
		{#if recapData}
			<div class="space-y-8">
				<!-- Player Info -->
				<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
					<div class="flex items-center gap-6">
						<div>
							<h2 class="text-3xl font-bold text-white">
								{#if accountData?.gameName}
									{accountData.gameName}
									<span class="text-slate-400">#{accountData.tagLine}</span>
								{:else}
									{gameName}
									<span class="text-slate-400">#{tagLine}</span>
								{/if}
							</h2>
							<p class="text-sm text-slate-400">
								{recapData.year || new Date().getFullYear()} Recap
								{#if recapData.lastUpdated}
									- Last Updated: {new Date(recapData.lastUpdated).toLocaleString()}
								{/if}
							</p>
						</div>
					</div>
				</div>

				<!-- Top 3 Champions -->
				{#if recapData.stats.top3Champions && recapData.stats.top3Champions.length > 0}
					<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
						<h3 class="mb-4 text-2xl font-bold text-white">🏆 Top 3 Most Played Champions</h3>
						<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
							{#each recapData.stats.top3Champions as champion}
								<div class="rounded-lg bg-slate-700/50 p-4">
									<div class="flex items-center gap-4">
										<div class="h-16 w-16 overflow-hidden rounded-lg border-2 border-blue-500">
											<img
												src={getChampionIconUrl(champion.championName)}
												alt={champion.championName}
												width="64"
												height="64"
												class="object-cover"
											/>
										</div>
										<div class="flex-1">
											<p class="text-lg font-bold text-white">{champion.championName}</p>
											<p class="text-sm text-slate-300">{champion.gamesPlayed} games played</p>
											<p class="text-sm text-slate-400">
												{champion.wins}W - {champion.losses}L ({(champion.winRate * 100).toFixed(
													0
												)}% WR)
											</p>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Favorite Champions by Role -->
				{#if recapData.stats.favoriteChampions && recapData.stats.favoriteChampions.length > 0}
					<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
						<h3 class="mb-4 text-2xl font-bold text-white">⭐ Favorite Champions (by Role)</h3>
						<p class="mb-4 text-sm text-slate-400">
							Champions with best win rate (minimum 3 games) in each role
						</p>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{#each recapData.stats.favoriteChampions as champion}
								<div class="rounded-lg bg-slate-700/50 p-4">
									<div class="flex items-center gap-3">
										<div class="h-12 w-12 overflow-hidden rounded-lg border-2 border-green-500">
											<img
												src={getChampionIconUrl(champion.championName)}
												alt={champion.championName}
												width="48"
												height="48"
												class="object-cover"
											/>
										</div>
										<div>
											<p class="font-semibold text-white">{champion.championName}</p>
											<p class="text-xs text-slate-400">{champion.role}</p>
											<p class="text-xs text-green-400">
												{champion.wins}/{champion.gamesPlayedWith} ({(
													champion.winRate * 100
												).toFixed(0)}% WR)
											</p>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Nemesis Champions -->
				{#if recapData.stats.nemesisChampions && recapData.stats.nemesisChampions.length > 0}
					<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
						<h3 class="mb-4 text-2xl font-bold text-white">😈 Nemesis Champions</h3>
						<p class="mb-4 text-sm text-slate-400">Lane opponents you struggled against</p>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{#each recapData.stats.nemesisChampions as champion}
								<div class="rounded-lg bg-red-900/30 p-4">
									<div class="flex items-center gap-3">
										<div class="h-12 w-12 overflow-hidden rounded-lg border-2 border-red-500">
											<img
												src={getChampionIconUrl(champion.championName)}
												alt={champion.championName}
												width="48"
												height="48"
												class="object-cover"
											/>
										</div>
										<div>
											<p class="font-semibold text-white">{champion.championName}</p>
											<p class="text-xs text-red-400">
												{champion.losses}/{champion.gamesAgainst} losses ({(
													champion.lossRate * 100
												).toFixed(0)}% loss rate)
											</p>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Hated Champions by Role -->
				{#if recapData.stats.hatedChampions && recapData.stats.hatedChampions.length > 0}
					<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
						<h3 class="mb-4 text-2xl font-bold text-white">💀 Hated Champions (by Role)</h3>
						<p class="mb-4 text-sm text-slate-400">
							Enemy champions by role you struggled against most
						</p>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{#each recapData.stats.hatedChampions as champion}
								<div class="rounded-lg bg-red-900/30 p-4">
									<div class="flex items-center gap-3">
										<div class="h-12 w-12 overflow-hidden rounded-lg border-2 border-red-500">
											<img
												src={getChampionIconUrl(champion.championName)}
												alt={champion.championName}
												width="48"
												height="48"
												class="object-cover"
											/>
										</div>
										<div>
											<p class="font-semibold text-white">{champion.championName}</p>
											<p class="text-xs text-slate-400">{champion.role}</p>
											<p class="text-xs text-red-400">
												{champion.losses}/{champion.gamesAgainst} losses ({(
													champion.lossRate * 100
												).toFixed(0)}% loss rate)
											</p>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Empty State -->
		{#if !recapData && !loading && !error}
			<div class="text-center text-slate-400">
				<p>Enter a summoner name to generate your {new Date().getFullYear()} recap</p>
			</div>
		{/if}
	</div>
</div>
