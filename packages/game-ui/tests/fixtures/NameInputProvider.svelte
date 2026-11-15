<script lang="ts">
import type { NameField } from "@openparty/game-ui";
import type { BaseGameState } from "@openparty/shared/schema";
import NameInput from "../../src/components/NameInput.svelte";
import { setStrings } from "../../src/strings.js";

const { field }: { field: NameField<BaseGameState> } = $props();
setStrings({ yourName: "Context" });
</script>

<NameInput {field} />
