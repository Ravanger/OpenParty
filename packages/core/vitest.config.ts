import { nodeTestConfig } from "@openparty/config/vitest";

export default nodeTestConfig({
  name: "@openparty/core",
  coverage: ["src/**/*.ts"],
});
