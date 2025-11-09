<script lang="ts">
	import { page } from '$app/state';
	import {
		getChampionIconUrl,
		getProfileIconUrl,
		getChampionNameById,
		getQueueName,
		getItemIconUrl,
		formatGameDuration,
		calculateKDA,
		getSummonerSpellIconUrlById
	} from '$lib/data-dragon';
	import autoAnimate from '@formkit/auto-animate';
	import VoicePlayer from '$lib/components/VoicePlayer.svelte';
	import TypewriterText from '$lib/components/TypewriterText.svelte';
	import ChampionStatsChart from '$lib/components/ChampionStatsChart.svelte';
	import CoachingObservation from '$lib/components/CoachingObservation.svelte';
	import { useChampionVoice } from '$lib/queries/voice-metadata';
	import { useCoachingWebSocket, type CoachingWebSocketStore, type CoachingObservation as CoachingObservationType, type CoachingConnectionState } from '$lib/hooks/useCoachingWebSocket';
	import type { AccountData, RecapData } from '$lib/types/recap';

	let gameName = $state('');
	let tagLine = $state('');
	let platform = $state('');
	let region = $state('');
	let loading = $state(true);
	let loadingProgress = $state('');
	let error = $state<string | null>(null);
	let recapData = $state<RecapData | null>(null);
	let accountData = $state<AccountData | null>(null);
	let championNames = $state<Record<number, string>>({});
	let totalMatches = $state(0);
	let processedMatches = $state(0);

	// Coaching state
	let coachingEnabled = $state(false);
	let coachingSession = $state<CoachingWebSocketStore | null>(null);
	let showCoaching = $state(false);

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
							if (chunk.puuid && !accountData) {
								// Create partial account data with required fields
								accountData = {
									puuid: chunk.puuid,
									gameName: gameName,
									tagLine: tagLine
								};
							}
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

							if (accountData?.topChampionMastery) {
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

	function getRankDisplay(tier: string, rank: string): string {
		if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) {
			return tier;
		}
		return `${tier} ${rank}`;
	}

	function calculateWinRate(wins: number, losses: number): string {
		const total = wins + losses;
		if (total === 0) return '0';
		return ((wins / total) * 100).toFixed(1);
	}

	let progressPercentage = $derived.by(() => {
		if (totalMatches === 0) return 0;
		return Math.min(100, (processedMatches / totalMatches) * 100);
	});

	// Get voice for top champion (highest mastery from Riot API)
	// Use highest mastery champion (available immediately) instead of most played (requires match processing)
	let topChampionId = $derived(accountData?.topChampionMastery?.[0]?.championId);
	let topChampion = $state('');
	let championVoiceQuery = $derived(topChampion ? useChampionVoice(topChampion) : null);

	// Convert championId to champion name using Data Dragon
	$effect(() => {
		if (topChampionId) {
			getChampionNameById(topChampionId).then((name) => {
				topChampion = name;
			});
		}
	});

	// Show typewriter for complete status
	let showTypewriter = $state(false);

	$effect(() => {
		if (!loading && recapData) {
			showTypewriter = true;
		}
	});

	// Initialize coaching session when recap completes
	async function initializeCoaching() {
		if (!accountData?.puuid || !topChampion) {
			console.error('Missing required data for coaching:', { puuid: accountData?.puuid, topChampion });
			return;
		}

		try {
			// Call coaching API to initialize session
			const response = await fetch('/api/coaching', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					puuid: accountData.puuid,
					topChampion: topChampion
				})
			});

			if (!response.ok) {
				throw new Error(`Failed to initialize coaching: ${response.statusText}`);
			}

			const data = await response.json();
			console.log('[Coaching] Session initialized:', data);

			// Connect to WebSocket
			coachingSession = useCoachingWebSocket(data.wsUrl, data.sessionId, accountData.puuid, topChampion);
			showCoaching = true;

			console.log('[Coaching] WebSocket connected');
		} catch (err) {
			console.error('[Coaching] Failed to initialize:', err);
			error = err instanceof Error ? err.message : 'Failed to initialize coaching';
		}
	}

	// Start coaching when user clicks the button
	function handleStartCoaching() {
		coachingEnabled = true;
		initializeCoaching();
	}

	// Use $effect to manually subscribe to coaching session stores and update local state
	let connectionState = $state<CoachingConnectionState>('disconnected');
	let coachingError = $state<string | null>(null);
	let currentObservation = $state('');
	let currentMatchNumber = $state<number | null>(null);
	let observations = $state<CoachingObservationType[]>([]);

	$effect(() => {
		if (!coachingSession) {
			connectionState = 'disconnected';
			coachingError = null;
			currentObservation = '';
			currentMatchNumber = null;
			observations = [];
			return;
		}

		const unsubscribers = [
			coachingSession.connectionState.subscribe(val => connectionState = val),
			coachingSession.error.subscribe(val => coachingError = val),
			coachingSession.currentObservation.subscribe(val => currentObservation = val),
			coachingSession.currentMatchNumber.subscribe(val => currentMatchNumber = val),
			coachingSession.observations.subscribe(val => observations = val)
		];

		return () => {
			unsubscribers.forEach(unsub => unsub());
		};
	});
</script>

<div class="min-h-screen animated-bg p-4 sm:p-8">
	<div class="mx-auto max-w-7xl">
		<!-- Header -->
		<header class="mb-8 text-center">
			<h1 class="text-4xl sm:text-6xl font-black text-white mb-2 tracking-tight">
				Champion <span class="gradient-text">Recap</span>
			</h1>
			<p class="text-lg text-gray-400">
				{loading ? 'Processing your match history...' : 'Your Year in Review'}
			</p>
		</header>

		<!-- Error Message -->
		{#if error}
			<div class="alert alert-error mb-8 bg-red-950/50 backdrop-blur-sm border-red-800/50 card-hover shadow-lg">
				<span class="iconify lucide--alert-circle"></span>
				<div>
					<span class="font-bold text-xl">Error</span>
					<p class="mb-4">{error}</p>
					<a
						href="/"
						class="btn btn-primary btn-sm bg-primary-500 hover:bg-primary-600 inline-flex items-center gap-2"
					>
						<span class="iconify lucide--arrow-left w-4 h-4"></span>
						Back to home
					</a>
				</div>
			</div>
		{/if}

		<!-- Loading Progress -->
		{#if loading && !accountData && loadingProgress}
			<div class="card bg-black/60 backdrop-blur-xl border-gray-800/50 shadow-xl mb-8">
				<div class="card-body">
					<div class="flex flex-col items-center gap-6">
						<span class="loading loading-spinner loading-lg text-primary-500"></span>
						<div class="text-center text-gray-300 font-medium">
							<TypewriterText
								text={loadingProgress}
								interval={20}
								cursor={false}
							/>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Account Info (Centered at Top) -->
		{#if accountData}
			<div class="card bg-black/60 backdrop-blur-xl border-gray-800/50 card-hover shadow-xl mb-8">
				<div class="card-body">
					<div class="flex flex-col items-center gap-6">
						<!-- Summoner Icon -->
						{#if accountData.summoner?.profileIconId}
							<div class="relative">
								<div class="h-24 w-24 overflow-hidden rounded-2xl border-4 border-primary-500 shadow-lg glow-primary">
									<img
										src={getProfileIconUrl(accountData.summoner.profileIconId)}
										alt="Summoner Icon"
										width="96"
										height="96"
										class="object-cover"
									/>
								</div>
							</div>
						{/if}

						<div class="flex-1 text-center w-full">
							<h2 class="text-3xl sm:text-4xl font-bold text-white mb-3">
								{accountData.gameName || gameName}
								<span class="text-gray-500">#{accountData.tagLine || tagLine}</span>
							</h2>

							<!-- Rank Info -->
							{#if accountData.rankedEntries && accountData.rankedEntries.length > 0}
								<div class="mt-4 flex flex-wrap gap-4 justify-center">
									{#each accountData.rankedEntries as entry}
										{#if entry.queueType === 'RANKED_SOLO_5x5' || entry.queueType === 'RANKED_FLEX_SR'}
											<div class="card bg-gradient-to-br from-gray-900 to-black border border-gray-700 shadow-lg">
												<div class="card-body p-4">
													<p class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">
														{entry.queueType === 'RANKED_SOLO_5x5' ? 'Solo/Duo' : 'Flex'}
													</p>
													<span class="badge badge-warning badge-lg mb-2">{getRankDisplay(entry.tier, entry.rank)}</span>
													<p class="text-sm text-gray-300 font-semibold mb-1">
														{entry.leaguePoints} LP
													</p>
													<p class="text-xs text-gray-400">
														{entry.wins}W {entry.losses}L <span class="text-primary-500">({calculateWinRate(entry.wins, entry.losses)}%)</span>
													</p>
												</div>
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							<!-- Top Champion Mastery (Centered) -->
							{#if accountData.topChampionMastery && accountData.topChampionMastery.length > 0}
								<div class="mt-6">
									<p class="text-sm font-bold text-gray-300 mb-4 uppercase tracking-wide">Top Champion Mastery</p>
									<div class="flex flex-wrap gap-3 justify-center">
										{#each accountData.topChampionMastery as mastery}
											<div class="card bg-gradient-to-br from-purple-900/30 to-black border border-purple-700/30 card-hover shadow-lg">
												<div class="card-body p-3">
													<div class="flex items-center gap-3">
														{#if championNames[mastery.championId]}
															<div class="h-12 w-12 overflow-hidden rounded-lg border-2 border-purple-500 shadow-lg">
																<img
																	src={getChampionIconUrl(championNames[mastery.championId])}
																	alt={championNames[mastery.championId]}
																	width="48"
																	height="48"
																	class="object-cover"
																/>
															</div>
														{/if}
														<div>
															<p class="text-sm text-white font-bold">
																{championNames[mastery.championId] || `Champion ${mastery.championId}`}
															</p>
															<span class="badge badge-secondary badge-sm">Level {mastery.championLevel}</span>
															<p class="text-xs text-gray-400 mt-1">
																{mastery.championPoints.toLocaleString()} pts
															</p>
														</div>
													</div>
												</div>
											</div>
										{/each}
									</div>
								</div>
							{/if}

							<!-- Progress Bar -->
							{#if loading && totalMatches > 0}
								<div class="mt-6">
									<div class="flex justify-between items-center mb-2">
										<p class="text-sm text-gray-300 font-semibold">Processing Matches</p>
										<span class="badge badge-success">{processedMatches}/{totalMatches}</span>
									</div>
									<progress
										class="progress progress-success h-3"
										value={progressPercentage}
										max="100"
									></progress>
								</div>
							{/if}

							<!-- Total Matches Summary -->
							{#if totalMatches > 0 || recapData?.stats}
								<p class="mt-4 text-sm text-gray-400">
									Total Matches: <span class="badge">{recapData?.stats?.totalGames || totalMatches}</span>
									{#if recapData?.stats?.totalWins !== undefined && recapData?.stats?.totalLosses !== undefined}
										| Win Rate: <span class="badge badge-success">{calculateWinRate(recapData.stats.totalWins, recapData.stats.totalLosses)}%</span>
									{/if}
								</p>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Completion Message with Voice Player -->
		{#if !loading && recapData && showTypewriter}
			<div class="mb-8 space-y-6">
				<!-- Typewriter Coaching Message -->
				<div class="card bg-gradient-to-br from-purple-900/30 to-black border border-purple-700/30 card-hover shadow-xl">
					<div class="card-body">
						<TypewriterText
							text={[
								`Great job, ${gameName}! I've analyzed your ${recapData.stats.totalGames} matches from this season.`,
								`Let's dive into your performance and see where you can improve!`
							]}
							interval={30}
						/>
					</div>
				</div>

				<!-- Voice Player for Top Champion -->
				{#if topChampion && championVoiceQuery && championVoiceQuery.data}
					<VoicePlayer
						audioUrl={championVoiceQuery.data.audioUrl}
						championName={topChampion}
					/>
				{/if}

				<!-- Coaching Button -->
				{#if !coachingEnabled && topChampion}
					<div class="card bg-gradient-to-br from-blue-900/30 to-black border border-blue-700/30 card-hover shadow-xl">
						<div class="card-body text-center">
							<h3 class="text-2xl font-bold text-white mb-2">
								Want personalized coaching?
							</h3>
							<p class="text-gray-400 mb-4">
								Get match-by-match analysis from {topChampion}'s perspective
							</p>
							<button
								onclick={handleStartCoaching}
								class="btn btn-primary btn-lg"
							>
								<span class="iconify lucide--mic-2 w-5 h-5"></span>
								Start Coaching Session
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Coaching Observations Section -->
		{#if showCoaching && coachingSession}
			<div class="mb-8 space-y-6">
				<div class="card bg-black/60 backdrop-blur-xl border-gray-800/50 shadow-xl">
					<div class="card-body">
						<h2 class="text-3xl font-bold text-white mb-4 flex items-center gap-3">
							<span class="iconify lucide--mic-2 w-8 h-8 text-purple-400"></span>
							Coaching Observations
						</h2>
						<p class="text-gray-400 mb-4">
							{topChampion} is analyzing your matches and providing personalized feedback
						</p>

						<!-- Connection Status -->
						<div class="flex items-center gap-2 mb-4">
							{#if connectionState === 'connecting'}
								<span class="loading loading-spinner loading-sm text-yellow-500"></span>
								<span class="text-sm text-yellow-500">Connecting...</span>
							{:else if connectionState === 'connected'}
								<span class="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
								<span class="text-sm text-green-500">Connected</span>
							{:else if connectionState === 'error'}
								<span class="iconify lucide--alert-circle w-4 h-4 text-red-500"></span>
								<span class="text-sm text-red-500">Connection Error</span>
							{:else}
								<span class="h-2 w-2 rounded-full bg-gray-500"></span>
								<span class="text-sm text-gray-500">Disconnected</span>
							{/if}
						</div>

						<!-- Error Message -->
						{#if coachingError}
							<div class="alert alert-error mb-4">
								<span class="iconify lucide--alert-circle"></span>
								<span>{coachingError}</span>
							</div>
						{/if}
					</div>
				</div>

				<!-- Current Streaming Observation -->
				{#if currentObservation && currentMatchNumber}
					<CoachingObservation
						observation={{
							matchNumber: currentMatchNumber,
							text: '',
							champion: topChampion,
							timestamp: new Date().toISOString()
						}}
						isStreaming={true}
						streamingText={currentObservation}
					/>
				{/if}

				<!-- Completed Observations -->
				<div use:autoAnimate class="space-y-6">
					{#each observations as observation (observation.timestamp)}
						<CoachingObservation {observation} />
					{/each}
				</div>
			</div>
		{/if}

		<!-- Champion Stats Chart -->
		{#if recapData?.stats?.top3Champions && recapData.stats.top3Champions.length > 0}
			<div class="mb-8">
				<ChampionStatsChart
					data={recapData.stats.top3Champions}
					title="Your Top Champions Win Rate"
				/>
			</div>
		{/if}

		<!-- Two Column Layout for Recap Data -->
		{#if recapData}
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
				<!-- Left Column: Top 3 Champions + Best Teammates -->
				<div class="space-y-8">
					<!-- Top 3 Champions -->
					{#if recapData.stats.top3Champions && recapData.stats.top3Champions.length > 0}
						<div class="card bg-black/60 backdrop-blur-xl border-gray-800/50 card-hover shadow-xl">
							<div class="card-body">
								<h3 class="mb-6 text-3xl font-bold text-white flex items-center gap-3">
									<span class="text-4xl">🏆</span>
									Top 3 Champions
								</h3>
								<div use:autoAnimate class="grid grid-cols-1 gap-4">
									{#each recapData.stats.top3Champions as champion, i}
										<div class="card group bg-gradient-to-br from-gray-900 to-black border-2 border-gray-700 hover:border-primary-500 transition-all duration-300 relative shadow-lg">
											<div class="card-body p-4">
												<!-- Rank Badge -->
												<span class="badge badge-warning badge-lg absolute -top-3 -left-3 w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold">
													{i + 1}
												</span>
												<div class="flex items-center gap-4 pt-2">
													<div class="h-16 w-16 overflow-hidden rounded-xl border-3 border-primary-500 shadow-lg group-hover:scale-110 transition-transform duration-300">
														<img
															src={getChampionIconUrl(champion.championName)}
															alt={champion.championName}
															width="64"
															height="64"
															class="object-cover"
														/>
													</div>
													<div class="flex-1">
														<p class="text-xl font-bold text-white mb-1">{champion.championName}</p>
														<p class="text-2xl font-black text-primary-500 mb-1">{champion.gamesPlayed} games</p>
														<div class="flex items-center gap-2 text-sm mb-1 flex-wrap">
															<span class="badge badge-success">{champion.wins}W</span>
															<span class="text-gray-500">-</span>
															<span class="badge badge-error">{champion.losses}L</span>
															<span class="badge badge-primary">{(champion.winRate * 100).toFixed(0)}% WR</span>
														</div>
													</div>
												</div>
											</div>
										</div>
									{/each}
								</div>
							</div>
						</div>
					{/if}

					<!-- Best Teammates (Favorite Champions) -->
					{#if recapData.stats.favoriteChampions && recapData.stats.favoriteChampions.length > 0}
						<div class="card bg-black/60 backdrop-blur-xl border-gray-800/50 card-hover shadow-xl">
							<div class="card-body">
								<h3 class="mb-4 text-3xl font-bold text-white flex items-center gap-3">
									<span class="text-4xl">💚</span>
									Best Teammates
								</h3>
								<p class="mb-6 text-sm text-gray-400">
									Champions with highest win rate when on your team (minimum 3 games)
								</p>
								<div use:autoAnimate class="grid grid-cols-1 gap-3">
									{#each recapData.stats.favoriteChampions as champion}
										<div class="card bg-gradient-to-br from-green-900/20 to-black border-2 border-green-700/30 hover:border-primary-500 transition-all duration-300 card-hover shadow-lg">
											<div class="card-body p-3">
												<div class="flex items-center gap-4">
													<div class="h-12 w-12 overflow-hidden rounded-lg border-2 border-primary-500 shadow-lg">
														<img
															src={getChampionIconUrl(champion.championName)}
															alt={champion.championName}
															width="48"
															height="48"
															class="object-cover"
														/>
													</div>
													<div class="flex-1">
														<p class="font-bold text-white text-base mb-1">{champion.championName}</p>
														<div class="flex items-center gap-2 flex-wrap">
															<span class="badge badge-sm">{champion.role}</span>
															<span class="badge badge-success badge-sm">{champion.wins}/{champion.gamesPlayedWith}</span>
															<span class="badge badge-primary badge-sm">{(champion.winRate * 100).toFixed(0)}% WR</span>
														</div>
													</div>
												</div>
											</div>
										</div>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</div>

				<!-- Right Column: Your Nemesis + Most Hated by Role -->
				<div class="space-y-8">
					<!-- Nemesis Champions -->
					{#if recapData.stats.nemesisChampions && recapData.stats.nemesisChampions.length > 0}
						<div class="card bg-black/60 backdrop-blur-xl border-red-900/50 card-hover shadow-xl">
							<div class="card-body">
								<h3 class="mb-4 text-3xl font-bold text-white flex items-center gap-3">
									<span class="text-4xl">💀</span>
									Your Nemesis
								</h3>
								<p class="mb-6 text-sm text-gray-400">Lane opponents you struggled against most</p>
								<div use:autoAnimate class="grid grid-cols-1 gap-3">
									{#each recapData.stats.nemesisChampions as champion}
										<div class="card bg-gradient-to-br from-red-950/30 to-black border-2 border-red-700/30 hover:border-red-500 transition-all duration-300 card-hover shadow-lg">
											<div class="card-body p-3">
												<div class="flex items-center gap-4">
													<div class="h-12 w-12 overflow-hidden rounded-lg border-2 border-red-500 shadow-lg">
														<img
															src={getChampionIconUrl(champion.championName)}
															alt={champion.championName}
															width="48"
															height="48"
															class="object-cover"
														/>
													</div>
													<div class="flex-1">
														<p class="font-bold text-white text-base mb-1">{champion.championName}</p>
														<div class="flex items-center gap-2 flex-wrap">
															<span class="badge badge-error badge-sm">{champion.role}</span>
															<span class="badge badge-error badge-sm">{champion.losses}/{champion.gamesAgainst} losses</span>
															<span class="badge badge-sm">{(champion.lossRate * 100).toFixed(0)}%</span>
														</div>
													</div>
												</div>
											</div>
										</div>
									{/each}
								</div>
							</div>
						</div>
					{/if}

					<!-- Hated Champions -->
					{#if recapData.stats.hatedChampions && recapData.stats.hatedChampions.length > 0}
						<div class="card bg-black/60 backdrop-blur-xl border-red-900/50 card-hover shadow-xl">
							<div class="card-body">
								<h3 class="mb-4 text-3xl font-bold text-white flex items-center gap-3">
									<span class="text-4xl">😤</span>
									Most Hated by Role
								</h3>
								<p class="mb-6 text-sm text-gray-400">
									Enemy champions by role you struggled against most
								</p>
								<div use:autoAnimate class="grid grid-cols-1 gap-3">
									{#each recapData.stats.hatedChampions as champion}
										<div class="card bg-gradient-to-br from-orange-950/30 to-black border-2 border-orange-700/30 hover:border-orange-500 transition-all duration-300 card-hover shadow-lg">
											<div class="card-body p-3">
												<div class="flex items-center gap-4">
													<div class="h-12 w-12 overflow-hidden rounded-lg border-2 border-orange-500 shadow-lg">
														<img
															src={getChampionIconUrl(champion.championName)}
															alt={champion.championName}
															width="48"
															height="48"
															class="object-cover"
														/>
													</div>
													<div class="flex-1">
														<p class="font-bold text-white text-base mb-1">{champion.championName}</p>
														<div class="flex items-center gap-2 flex-wrap">
															<span class="badge badge-warning badge-sm">{champion.role}</span>
															<span class="badge badge-error badge-sm">{champion.losses}/{champion.gamesAgainst} losses</span>
															<span class="badge badge-sm">{(champion.lossRate * 100).toFixed(0)}%</span>
														</div>
													</div>
												</div>
											</div>
										</div>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Match History Feed (op.gg-style) -->
		{#if recapData?.matchHistory && recapData.matchHistory.length > 0}
			<div class="mt-8">
				<div class="card bg-black/60 backdrop-blur-xl border-gray-800/50 shadow-xl">
					<div class="card-body">
						<h3 class="mb-6 text-3xl font-bold text-white flex items-center gap-3">
							<span class="iconify lucide--sword w-8 h-8 text-primary-500"></span>
							Recent Match History
						</h3>
						<div use:autoAnimate class="space-y-3">
							{#each recapData.matchHistory as match}
								<div
									class="card bg-gradient-to-br from-gray-900 to-black border-l-4 {match.win
										? 'border-l-green-500'
										: 'border-l-red-500'} border-gray-700 hover:border-primary-500 transition-all duration-300 card-hover shadow-lg"
								>
									<div class="card-body p-4">
										<div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
											<!-- Game Info -->
											<div class="flex-shrink-0 w-full sm:w-auto">
												<div class="flex items-center gap-2 mb-2">
													<span class="badge badge-sm">{getQueueName(match.queueId)}</span>
													<span
														class="badge badge-sm {match.win
															? 'badge-success'
															: 'badge-error'}"
													>
														{match.win ? 'Victory' : 'Defeat'}
													</span>
													<span class="text-xs text-gray-400">
														{formatGameDuration(match.gameDuration)}
													</span>
												</div>
												<p class="text-xs text-gray-500">
													{new Date(match.gameCreation).toLocaleDateString()}
												</p>
											</div>

											<!-- Champion & Summoner Spells -->
											<div class="flex items-center gap-3 flex-shrink-0">
												<div class="flex gap-1">
													<!-- Champion Icon -->
													<div
														class="h-14 w-14 overflow-hidden rounded-lg border-2 {match.win
															? 'border-green-500'
															: 'border-red-500'} shadow-lg"
													>
														<img
															src={getChampionIconUrl(match.championName)}
															alt={match.championName}
															width="56"
															height="56"
															class="object-cover"
														/>
													</div>
													<!-- Summoner Spells -->
													<div class="flex flex-col gap-1">
														<div class="h-6 w-6 overflow-hidden rounded border border-gray-600 bg-gray-800">
															<img
																src={getSummonerSpellIconUrlById(match.summoner1Id)}
																alt="Summoner Spell 1"
																width="24"
																height="24"
																class="object-cover"
															/>
														</div>
														<div class="h-6 w-6 overflow-hidden rounded border border-gray-600 bg-gray-800">
															<img
																src={getSummonerSpellIconUrlById(match.summoner2Id)}
																alt="Summoner Spell 2"
																width="24"
																height="24"
																class="object-cover"
															/>
														</div>
													</div>
												</div>
												<div>
													<p class="text-sm font-bold text-white">
														{match.championName}
													</p>
													<span class="badge badge-xs">{match.position || 'N/A'}</span>
												</div>
											</div>

											<!-- KDA & Stats -->
											<div class="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-4">
												<!-- KDA -->
												<div>
													<p class="text-xs text-gray-400 mb-1">KDA</p>
													<p class="text-sm font-bold text-white">
														{match.kills}/{match.deaths}/{match.assists}
													</p>
													<p class="text-xs text-primary-500">
														{calculateKDA(match.kills, match.deaths, match.assists)} KDA
													</p>
												</div>

												<!-- CS & Vision -->
												<div>
													<p class="text-xs text-gray-400 mb-1">CS / Vision</p>
													<p class="text-sm font-bold text-white">
														{match.totalMinionsKilled} CS
													</p>
													<p class="text-xs text-gray-400">
														{match.visionScore} Vision
													</p>
												</div>

												<!-- Items -->
												<div class="col-span-2 sm:col-span-1">
													<p class="text-xs text-gray-400 mb-1">Items</p>
													<div class="flex gap-1 flex-wrap">
														{#each match.items as itemId}
															{#if itemId !== 0}
																<div
																	class="h-8 w-8 overflow-hidden rounded border border-gray-600 bg-gray-800"
																>
																	<img
																		src={getItemIconUrl(itemId)}
																		alt="Item {itemId}"
																		width="32"
																		height="32"
																		class="object-cover"
																	/>
																</div>
															{/if}
														{/each}
													</div>
												</div>
											</div>

											<!-- Team Compositions -->
											<div class="mt-3 pt-3 border-t border-gray-700/50 flex gap-6">
												<!-- Your Team -->
												<div class="flex-1">
													<p class="text-xs text-gray-400 mb-2">Your Team</p>
													<div class="flex gap-1">
														{#each match.teamChampions as championId}
															{#await getChampionNameById(championId) then championName}
																<div class="h-7 w-7 overflow-hidden rounded border border-blue-500/50 bg-gray-800" title={championName}>
																	<img
																		src={getChampionIconUrl(championName)}
																		alt={championName}
																		width="28"
																		height="28"
																		class="object-cover"
																	/>
																</div>
															{/await}
														{/each}
													</div>
												</div>

												<!-- Enemy Team -->
												<div class="flex-1">
													<p class="text-xs text-gray-400 mb-2">Enemy Team</p>
													<div class="flex gap-1">
														{#each match.enemyChampions as championId}
															{#await getChampionNameById(championId) then championName}
																<div class="h-7 w-7 overflow-hidden rounded border border-red-500/50 bg-gray-800" title={championName}>
																	<img
																		src={getChampionIconUrl(championName)}
																		alt={championName}
																		width="28"
																		height="28"
																		class="object-cover"
																	/>
																</div>
															{/await}
														{/each}
													</div>
												</div>
											</div>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Empty State -->
		{#if !recapData && !loading && !error}
			<div class="card text-center py-16 bg-black/40 border-gray-800/50 shadow-xl">
				<div class="card-body">
					<span class="loading loading-spinner loading-lg"></span>
					<p class="text-lg text-gray-400 mt-4">Waiting for data...</p>
				</div>
			</div>
		{/if}

		<!-- Back Button -->
		{#if !loading || error}
			<div class="mt-12 text-center">
				<a
					href="/"
					class="btn btn-primary btn-lg bg-primary-500 hover:bg-primary-600 transition-all duration-300 hover:shadow-2xl hover:shadow-primary-500/50 hover:scale-105 active:scale-95 inline-flex items-center gap-2"
				>
					<span class="iconify lucide--arrow-left w-5 h-5"></span>
					Generate Another Recap
				</a>
			</div>
		{/if}
	</div>
</div>
