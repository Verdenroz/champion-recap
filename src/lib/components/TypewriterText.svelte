<script lang="ts">
	import Typewriter from 'svelte-typewriter';

	interface TypewriterTextProps {
		text: string | string[];
		interval?: number;
		cursor?: boolean;
		loop?: boolean;
		onComplete?: () => void;
	}

	let { text, interval = 50, cursor = true, loop = false, onComplete }: TypewriterTextProps = $props();
</script>

<div class="typewriter-text">
	{#if onComplete}
		<Typewriter {interval} {cursor} {loop} on:done={() => onComplete()}>
			{#if Array.isArray(text)}
				{#each text as line, i (i)}
					<p class="mb-2">{line}</p>
				{/each}
			{:else}
				{text}
			{/if}
		</Typewriter>
	{:else}
		<Typewriter {interval} {cursor} {loop}>
			{#if Array.isArray(text)}
				{#each text as line, i (i)}
					<p class="mb-2">{line}</p>
				{/each}
			{:else}
				{text}
			{/if}
		</Typewriter>
	{/if}
</div>

<style>
	.typewriter-text :global(.typed-cursor) {
		animation: blink 1s infinite;
	}

	@keyframes blink {
		0%, 49% {
			opacity: 1;
		}
		50%, 100% {
			opacity: 0;
		}
	}
</style>
