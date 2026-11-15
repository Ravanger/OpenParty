<script lang="ts">
import { readUrlCode, readUrlTvCode } from "@openparty/game-client";
import { WelcomeViewModel } from "@openparty/game-ui";
import { WelcomeScreen } from "@openparty/game-ui/components";
import { untrack } from "svelte";
import type { BluffManager } from "../manager.js";

const { manager }: { manager: BluffManager } = $props();

const vm = untrack(() => new WelcomeViewModel(manager, readUrlCode(), readUrlTvCode()));
</script>

<WelcomeScreen vm={vm} title="Bluff" tagline="Fake an answer, then spot the real one." />
