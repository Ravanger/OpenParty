<script lang="ts">
import { WaitingRoomViewModel } from "@openparty/game-ui";
import { LobbyScreen } from "@openparty/game-ui/components";
import { untrack } from "svelte";
import type { __PascalName__Manager } from "../manager.js";

const { manager }: { manager: __PascalName__Manager } = $props();

const vm = untrack(() => new WaitingRoomViewModel(manager));

$effect(() => () => vm.destroy());
</script>

<LobbyScreen {vm} />
