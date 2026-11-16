import { uiTestConfig } from "@openparty/config/vitest";

export default uiTestConfig({
  name: "@openparty/game-client",
  coverage: ["src/**/*.ts"],
  setupFiles: ["./vitest.setup.ts"],
});
