<script lang="ts">
	import { page } from '$app/state';
	import { getChampionIconUrl, getProfileIconUrl, getChampionNameById } from '$lib/data-dragon';

	let gameName = $state('');
	let tagLine = $state('');
	let platform = $state('');
	let region = $state('');
	let loading = $state(true);
	let loadingProgress = $state('');
	let error = $state<string | null>(null);
	let recapData = $state<any>(null);
	let accountData = $state<any>(null);
	let championNames = $state<Record<number, string>>({});
	let totalMatches = $state(0);
	let processedMatches = $state(0);

	// Extract params from URL
	$effect(() => {
		gameName = page.url.searchParams.get('gameName') || '';
		tagLine = page.url.searchParams.get('tagLine') || '';
		platform = page.url.searchParams.get('platform') || 'na1';
		region = page.url.searchParams.get('region') || 'americas';

		if (!gameName || !tagLine) {
			error = 'Missing required parameters: gameName and tagLine';
			loading = false;
			return;
		}

		// Start the progressive loading
		handleProgressiveLoad();
	});

	async function handleProgressiveLoad() {
		try {
			const eventSource = new EventSource(
				`/api/player/stream?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}&platform=${platform}&region=${region}`
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
							// Update match counts from status
							if (chunk.totalMatches !== undefined) {
								totalMatches = chunk.totalMatches;
							}
							if (chunk.processedMatches !== undefined) {
								processedMatches = chunk.processedMatches;
							}
							break;

						case 'player_info':
							accountData = chunk.account;
							loadingProgress = 'Fetching player information...';

							// Resolve champion names for mastery
							if (accountData.topChampionMastery) {
								for (const mastery of accountData.topChampionMastery) {
									getChampionNameById(mastery.championId).then((name: string) => {
										championNames[mastery.championId] = name;
									});
								}
							}
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

	// Helper function to get rank display
	function getRankDisplay(tier: string, rank: string): string {
		if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) {
			return tier;
		}
		return `${tier} ${rank}`;
	}

	// Helper function to calculate win rate
	function calculateWinRate(wins: number, losses: number): string {
		const total = wins + losses;
		if (total === 0) return '0';
		return ((wins / total) * 100).toFixed(1);
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4 sm:p-8">
	<div class="mx-auto max-w-6xl">
		<!-- Header -->
		<header class="mb-8 text-center">
			<h1 class="text-4xl font-bold text-white sm:text-5xl">
				League of Legends {new Date().getFullYear()} Recap
			</h1>
			<p class="mt-2 text-slate-300">Processing your match history...</p>
		</header>

		<!-- Error Message -->
		{#if error}
			<div class="mb-8 rounded-lg bg-red-900/50 p-4 text-red-200">
				<p class="font-semibold">Error:</p>
				<p>{error}</p>
				<a href="/" class="mt-4 inline-block text-blue-300 hover:text-blue-200">
					← Back to home
				</a>
			</div>
		{/if}

		<!-- Loading Progress (only show when no profile info) -->
		{#if loading && !accountData && loadingProgress}
			<div class="mb-8 rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
				<div class="flex flex-col items-center gap-4">
					<div class="h-16 w-16 animate-spin rounded-full border-4 border-slate-600 border-t-blue-500"></div>
					<p class="text-center text-sm text-slate-400">{loadingProgress}</p>
				</div>
			</div>
		{/if}

		<!-- Account Info -->
		{#if accountData}
			<div class="mb-8 rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
				<div class="flex flex-col items-start gap-6 md:flex-row md:items-center">
					<!-- Summoner Icon -->
					{#if accountData.summoner?.profileIconId}
						<div class="h-24 w-24 overflow-hidden rounded-lg border-4 border-blue-500 shadow-lg">
							<img
								src={getProfileIconUrl(accountData.summoner.profileIconId)}
								alt="Summoner Icon"
								width="96"
								height="96"
								class="object-cover"
							/>
						</div>
					{/if}

					<div class="flex-1">
						<h2 class="text-3xl font-bold text-white">
							{accountData.gameName || gameName}
							<span class="text-slate-400">#{accountData.tagLine || tagLine}</span>
						</h2>

						<!-- Rank Info -->
						{#if accountData.rankedEntries && accountData.rankedEntries.length > 0}
							<div class="mt-3 flex flex-wrap gap-4">
								{#each accountData.rankedEntries as entry}
									{#if entry.queueType === 'RANKED_SOLO_5x5' || entry.queueType === 'RANKED_FLEX_SR'}
										<div class="rounded-lg bg-slate-700/50 px-4 py-2">
											<p class="text-xs text-slate-400">
												{entry.queueType === 'RANKED_SOLO_5x5'
													? 'Solo/Duo'
													: 'Flex'}
											</p>
											<p class="text-lg font-bold text-yellow-400">
												{getRankDisplay(entry.tier, entry.rank)}
											</p>
											<p class="text-sm text-slate-300">
												{entry.leaguePoints} LP
											</p>
											<p class="text-xs text-slate-400">
												{entry.wins}W {entry.losses}L ({calculateWinRate(
													entry.wins,
													entry.losses
												)}%)
											</p>
										</div>
									{/if}
								{/each}
							</div>
						{/if}

						<!-- Top Champion Mastery -->
						{#if accountData.topChampionMastery && accountData.topChampionMastery.length > 0}
							<div class="mt-4">
								<p class="text-sm font-semibold text-slate-300 mb-2">Top Champion Mastery</p>
								<div class="flex flex-wrap gap-3">
									{#each accountData.topChampionMastery as mastery}
										<div class="rounded-lg bg-slate-700/50 px-3 py-2 flex items-center gap-2">
											{#if championNames[mastery.championId]}
												<div class="h-10 w-10 overflow-hidden rounded-lg border-2 border-purple-500">
													<img
														src={getChampionIconUrl(championNames[mastery.championId])}
														alt={championNames[mastery.championId]}
														width="40"
														height="40"
														class="object-cover"
													/>
												</div>
											{/if}
											<div>
												<p class="text-xs text-slate-300 font-semibold">
													{championNames[mastery.championId] || `Champion ${mastery.championId}`}
												</p>
												<p class="text-xs font-bold text-purple-400">
													Level {mastery.championLevel}
												</p>
												<p class="text-xs text-slate-400">
													{mastery.championPoints.toLocaleString()} pts
												</p>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Total Matches -->
						{#if totalMatches > 0 || recapData?.stats}
							<p class="mt-3 text-sm text-slate-400">
								Total Matches: <span class="font-semibold text-white"
									>{recapData?.stats?.totalGames || totalMatches}</span
								>
								{#if processedMatches > 0 && processedMatches < totalMatches}
									<span class="text-blue-400">
										(Processing: {processedMatches}/{totalMatches})
									</span>
								{/if}
								{#if recapData?.stats?.totalWins !== undefined && recapData?.stats?.totalLosses !== undefined}
									| Win Rate: <span class="font-semibold text-green-400"
										>{calculateWinRate(
											recapData.stats.totalWins,
											recapData.stats.totalLosses
										)}%</span
									>
								{/if}
							</p>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<!-- Recap Data -->
		{#if recapData}
			<div class="space-y-8">
				<!-- Top 3 Champions -->
				{#if recapData.stats.top3Champions && recapData.stats.top3Champions.length > 0}
					<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
						<h3 class="mb-4 text-2xl font-bold text-white">Top 3 Most Played Champions</h3>
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
						<h3 class="mb-4 text-2xl font-bold text-white">Favorite Champions (by Role)</h3>
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
						<h3 class="mb-4 text-2xl font-bold text-white">Nemesis Champions</h3>
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
						<h3 class="mb-4 text-2xl font-bold text-white">Hated Champions (by Role)</h3>
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

		<!-- Empty State / Still Loading -->
		{#if !recapData && !loading && !error}
			<div class="text-center text-slate-400">
				<p>Waiting for data...</p>
			</div>
		{/if}

		<!-- Back Button -->
		{#if !loading || error}
			<div class="mt-8 text-center">
				<a
					href="/"
					class="inline-block rounded-md bg-blue-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-blue-700"
				>
					← Generate Another Recap
				</a>
			</div>
		{/if}
	</div>
</div>
