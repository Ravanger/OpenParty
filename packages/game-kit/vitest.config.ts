import { nodeTestConfig } from "@openparty/config/vitest";

export default nodeTestConfig({
  name: "@openparty/game-kit",
  coverage: ["src/**/*.ts"],
});
