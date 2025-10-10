<script lang="ts">
	import { onMount } from 'svelte';
	import type { PlayerData, ParticipantDto } from '$lib/types/riot';
	import {
		getChampionIconUrl,
		getProfileIconUrl,
		getItemIconUrl,
		formatGameDuration,
		calculateKDA,
		formatNumber,
		getQueueName,
		preloadStaticData
	} from '$lib/data-dragon';

	// Preload static data on component mount
	onMount(() => {
		preloadStaticData();
	});

	let gameName = $state('');
	let tagLine = $state('');
	let loading = $state(false);
	let loadingProgress = $state('');
	let loadingPercentage = $state(0);
	let error = $state<string | null>(null);
	let playerData = $state<PlayerData | null>(null);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		error = null;
		playerData = null;
		loadingProgress = 'Fetching player data...';
		loadingPercentage = 0;

		await handleProgressiveLoad();
	}

	async function handleProgressiveLoad() {
		try {
			const eventSource = new EventSource(
				`/api/player/stream?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`
			);

			let totalMatches = 0;
			let loadedMatches = 0;
			const matches: any[] = [];

			eventSource.onmessage = (event) => {
				try {
					const chunk = JSON.parse(event.data);

					switch (chunk.type) {
						case 'player_info':
							loadingProgress = 'Loading player information...';
							playerData = {
								account: chunk.account,
								summoner: chunk.summoner,
								matches: [],
								totalMatches: 0,
								year: new Date().getFullYear()
							};
							break;

						case 'match_count':
							totalMatches = chunk.total;
							loadingProgress = `Loading ${totalMatches} matches...`;
							if (playerData) {
								playerData.totalMatches = totalMatches;
							}
							break;

						case 'matches':
							matches.push(...chunk.matches);
							loadedMatches = chunk.progress.current;
							loadingPercentage = Math.round((loadedMatches / chunk.progress.total) * 100);
							loadingProgress = `Loaded ${loadedMatches}/${chunk.progress.total} matches (${loadingPercentage}%)`;

							// Update player data progressively
							if (playerData) {
								playerData = {
									...playerData,
									matches: [...matches]
								};
							}
							break;

						case 'complete':
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

	function getPlayerStats(puuid: string) {
		return (match: any): ParticipantDto | undefined => {
			return match.info.participants.find((p: ParticipantDto) => p.puuid === puuid);
		};
	}

	// Calculate overall stats
	const calculateOverallStats = () => {
		if (!playerData) return null;

		let totalKills = 0;
		let totalDeaths = 0;
		let totalAssists = 0;
		let wins = 0;
		let losses = 0;
		const championStats: Record<string, { games: number; wins: number }> = {};

		playerData.matches.forEach((match) => {
			const stats = playerData ? getPlayerStats(playerData.account.puuid)(match) : undefined;
			if (!stats) return;

			totalKills += stats.kills;
			totalDeaths += stats.deaths;
			totalAssists += stats.assists;

			if (stats.win) {
				wins++;
			} else {
				losses++;
			}

			if (!championStats[stats.championName]) {
				championStats[stats.championName] = { games: 0, wins: 0 };
			}
			championStats[stats.championName].games++;
			if (stats.win) {
				championStats[stats.championName].wins++;
			}
		});

		const totalGames = wins + losses;
		const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : '0';
		const avgKDA =
			totalGames > 0
				? calculateKDA(totalKills / totalGames, totalDeaths / totalGames, totalAssists / totalGames)
				: '0';

		// Get most played champions
		const mostPlayed = Object.entries(championStats)
			.sort((a, b) => b[1].games - a[1].games)
			.slice(0, 5);

		return {
			totalGames,
			wins,
			losses,
			winRate,
			totalKills,
			totalDeaths,
			totalAssists,
			avgKDA,
			mostPlayed
		};
	};

	let stats = $derived(calculateOverallStats());
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4 sm:p-8">
	<div class="mx-auto max-w-6xl">
		<!-- Header -->
		<header class="mb-8 text-center">
			<h1 class="text-4xl font-bold text-white sm:text-5xl">
				League of Legends {new Date().getFullYear()} Recap
			</h1>
			<p class="mt-2 text-slate-300">
				View your complete League of Legends stats for the year
			</p>
		</header>

		<!-- Search Form -->
		<div class="mb-8 rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
			<form onsubmit={handleSubmit} class="flex flex-col gap-4 sm:flex-row">
				<div class="flex-1">
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
				<div class="flex-1">
					<label for="tagLine" class="mb-1 block text-sm font-medium text-slate-300">
						Tag Line
					</label>
					<input
						type="text"
						id="tagLine"
						bind:value={tagLine}
						placeholder="Tag Line (e.g., NA1)"
						required
						class="w-full rounded-md border border-slate-600 bg-slate-700 px-4 py-2 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<div class="flex items-end">
					<button
						type="submit"
						disabled={loading}
						class="w-full rounded-md bg-blue-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-slate-600 sm:w-auto"
					>
						{loading ? 'Loading...' : 'Generate Recap'}
					</button>
				</div>
			</form>
			{#if loadingProgress}
				<div class="mt-4">
					<p class="mb-2 text-center text-sm text-slate-400">{loadingProgress}</p>
					{#if loadingPercentage > 0}
						<div class="h-2 w-full overflow-hidden rounded-full bg-slate-700">
							<div
								class="h-full bg-blue-600 transition-all duration-300"
								style="width: {loadingPercentage}%"
							></div>
						</div>
					{/if}
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

		<!-- Player Data -->
		{#if playerData && stats}
			<div class="space-y-8">
				<!-- Summoner Info -->
				<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
					<div class="flex items-center gap-6">
						<div
							class="relative h-24 w-24 overflow-hidden rounded-full border-4 border-blue-500 shadow-lg"
						>
							<img
								src={getProfileIconUrl(playerData.summoner.profileIconId)}
								alt="Profile Icon"
								width="96"
								height="96"
								class="object-cover"
							/>
							<div
								class="absolute bottom-0 left-0 right-0 bg-slate-900/90 py-0.5 text-center text-xs font-bold text-white"
							>
								{playerData.summoner.summonerLevel}
							</div>
						</div>
						<div>
							<h2 class="text-3xl font-bold text-white">
								{playerData.account.gameName}
								<span class="text-slate-400">#{playerData.account.tagLine}</span>
							</h2>
							<p class="text-slate-300">Level {playerData.summoner.summonerLevel}</p>
							<p class="text-sm text-slate-400">
								{playerData.year} Recap - {playerData.totalMatches} Games Played
							</p>
						</div>
					</div>
				</div>

				<!-- Overall Stats -->
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
					<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
						<p class="text-sm text-slate-400">Total Games</p>
						<p class="text-3xl font-bold text-white">{stats.totalGames}</p>
					</div>
					<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
						<p class="text-sm text-slate-400">Win Rate</p>
						<p class="text-3xl font-bold text-white">{stats.winRate}%</p>
						<p class="text-xs text-slate-500">{stats.wins}W - {stats.losses}L</p>
					</div>
					<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
						<p class="text-sm text-slate-400">Average KDA</p>
						<p class="text-3xl font-bold text-white">{stats.avgKDA}</p>
					</div>
					<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
						<p class="text-sm text-slate-400">Total K/D/A</p>
						<p class="text-xl font-bold text-white">
							{stats.totalKills} / {stats.totalDeaths} / {stats.totalAssists}
						</p>
					</div>
				</div>

				<!-- Most Played Champions -->
				<div class="rounded-lg bg-slate-800/50 p-6 shadow-xl backdrop-blur-sm">
					<h3 class="mb-4 text-2xl font-bold text-white">Most Played Champions</h3>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
						{#each stats.mostPlayed as [championName, data] (championName)}
							<div class="flex items-center gap-3 rounded-lg bg-slate-700/50 p-3">
								<div class="h-12 w-12 overflow-hidden rounded-lg border-2 border-slate-600">
									<img
										src={getChampionIconUrl(championName)}
										alt={championName}
										width="48"
										height="48"
										class="object-cover"
									/>
								</div>
								<div>
									<p class="font-semibold text-white">{championName}</p>
									<p class="text-xs text-slate-400">{data.games} games</p>
									<p class="text-xs text-slate-400">
										{((data.wins / data.games) * 100).toFixed(0)}% WR
									</p>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Match History -->
				<div>
					<h3 class="mb-4 text-2xl font-bold text-white">
						All Matches ({playerData.matches.length})
					</h3>
					<div class="max-h-[600px] space-y-4 overflow-y-auto pr-2">
						{#each playerData.matches as match (match.metadata.matchId)}
							{@const playerStats = getPlayerStats(playerData.account.puuid)(match)}
							{#if playerStats}
								{@const isWin = playerStats.win}
								{@const gameDuration = Math.floor(match.info.gameDuration)}
								<div
									class="rounded-lg p-4 shadow-xl backdrop-blur-sm {isWin
										? 'border-l-4 border-blue-500 bg-blue-900/30'
										: 'border-l-4 border-red-500 bg-red-900/30'}"
								>
									<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
										<!-- Champion and Result -->
										<div class="flex items-center gap-3">
											<div
												class="relative h-12 w-12 overflow-hidden rounded-lg border-2 border-slate-700 shadow-md"
											>
												<img
													src={getChampionIconUrl(playerStats.championName)}
													alt={playerStats.championName}
													width="48"
													height="48"
													class="object-cover"
												/>
											</div>
											<div>
												<h4 class="text-lg font-bold text-white">
													{playerStats.championName}
												</h4>
												<p class="text-xs text-slate-300">
													{getQueueName(match.info.queueId)}
												</p>
											</div>
										</div>

										<!-- KDA -->
										<div class="text-center">
											<p class="text-lg font-bold text-white">
												{playerStats.kills} / {playerStats.deaths} / {playerStats.assists}
											</p>
											<p class="text-xs text-slate-300">
												{calculateKDA(playerStats.kills, playerStats.deaths, playerStats.assists)}
												KDA
											</p>
										</div>

										<!-- Stats -->
										<div class="grid grid-cols-3 gap-3 text-xs">
											<div class="text-center">
												<p class="font-semibold text-white">
													{formatNumber(playerStats.totalDamageDealtToChampions)}
												</p>
												<p class="text-slate-400">Damage</p>
											</div>
											<div class="text-center">
												<p class="font-semibold text-white">
													{playerStats.totalMinionsKilled + playerStats.neutralMinionsKilled}
												</p>
												<p class="text-slate-400">CS</p>
											</div>
											<div class="text-center">
												<p class="font-semibold text-white">
													{formatGameDuration(gameDuration)}
												</p>
												<p class="text-slate-400">Duration</p>
											</div>
										</div>

										<!-- Items -->
										<div class="flex gap-1">
											{#each [playerStats.item0, playerStats.item1, playerStats.item2, playerStats.item3, playerStats.item4, playerStats.item5, playerStats.item6] as itemId, idx (idx)}
												<div
													class="h-6 w-6 overflow-hidden rounded border border-slate-700 bg-slate-800"
												>
													{#if itemId !== 0}
														<img
															src={getItemIconUrl(itemId)}
															alt={`Item ${itemId}`}
															width="24"
															height="24"
															class="object-cover"
														/>
													{/if}
												</div>
											{/each}
										</div>
									</div>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			</div>
		{/if}

		<!-- Empty State -->
		{#if !playerData && !loading && !error}
			<div class="text-center text-slate-400">
				<p>Enter a summoner name to generate your {new Date().getFullYear()} recap</p>
			</div>
		{/if}
	</div>
</div>
