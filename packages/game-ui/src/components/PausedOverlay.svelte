<script lang="ts">
import { getStrings } from "../strings.js";

const { paused }: { paused: boolean } = $props();
const strings = getStrings();

let announcement = $state("");
$effect(() => {
  if (paused) announcement = strings.paused;
  else if (announcement !== "") announcement = strings.resumed;
});
</script>

<p class="sr-only" role="log" aria-live="polite" aria-label="Pause state">{announcement}</p>
{#if paused}
  <div class="paused-overlay">
    <h1>{strings.paused}</h1>
  </div>
{/if}

<style>
  .paused-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: color-mix(in srgb, var(--ink) 60%, transparent);
  }

  .paused-overlay h1 {
    margin: 0;
    padding: 2.5rem 3.5rem;
    font-family: var(--font-display);
    font-size: calc(var(--fs-6) * var(--scale, 1));
    color: var(--ink);
    background: var(--paper);
    border: var(--outline);
    border-radius: var(--radius-card);
    box-shadow: var(--scrap-shadow);
  }
</style>
