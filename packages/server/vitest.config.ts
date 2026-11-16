import { nodeTestConfig } from "@openparty/config/vitest";

export default nodeTestConfig({
  name: "@openparty/server",
  coverage: ["src/**/*.ts"],
  overrides: { test: { deps: { interopDefault: true } } },
});
