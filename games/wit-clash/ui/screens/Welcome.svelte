<script lang="ts">
import { readUrlCode, readUrlTvCode } from "@openparty/game-client";
import { WelcomeViewModel } from "@openparty/game-ui";
import { WelcomeScreen } from "@openparty/game-ui/components";
import { untrack } from "svelte";
import type { WitClashManager } from "../manager.js";

const { manager }: { manager: WitClashManager } = $props();

const vm = untrack(() => new WelcomeViewModel(manager, readUrlCode(), readUrlTvCode()));
</script>

<WelcomeScreen vm={vm} title="WitClash" tagline="Write funny answers. Vote for the best. Win bragging rights." />
