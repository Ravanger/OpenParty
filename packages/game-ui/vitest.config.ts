import { uiTestConfig } from "@openparty/config/vitest";

export default uiTestConfig({
  name: "@openparty/game-ui",
  coverage: ["src/**/*.{ts,svelte}"],
  setupFiles: ["./vitest.setup.ts"],
});
