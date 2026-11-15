import { fileURLToPath } from "node:url";
import { launch } from "@openparty/game-kit";
import { gamePackage } from "./gamePackage.js";

await launch(gamePackage, { gameDir: fileURLToPath(new URL(".", import.meta.url)) });
