<script lang="ts">
import type { GameControlsViewModel } from "@openparty/game-ui";
import type { BaseGameState } from "@openparty/shared/schema";
import GameControls from "../../src/components/GameControls.svelte";
import { setStrings } from "../../src/strings.js";

const { vm }: { vm: GameControlsViewModel<BaseGameState> } = $props();
setStrings({ leaveGame: "Spiel verlassen" });
</script>

<GameControls {vm} />
