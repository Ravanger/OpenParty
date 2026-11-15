import { nodeTestConfig } from "@openparty/config/vitest";

export default nodeTestConfig({
  name: "rush-game",
  include: ["tests/game/**/*.test.ts"],
  coverage: ["src/**/*.ts"],
});
