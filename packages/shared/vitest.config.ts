import { nodeTestConfig } from "@openparty/config/vitest";

export default nodeTestConfig({
  name: "@openparty/shared",
  coverage: ["src/**/*.ts"],
});
