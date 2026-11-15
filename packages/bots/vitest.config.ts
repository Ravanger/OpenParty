import { nodeTestConfig } from "@openparty/config/vitest";

export default nodeTestConfig({
  name: "@openparty/bots",
  coverage: ["src/**/*.ts"],
});
