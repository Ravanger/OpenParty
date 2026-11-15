import { nodeTestConfig } from "@openparty/config/vitest";

export default nodeTestConfig({
  name: "@openparty/launcher",
  coverage: ["src/**/*.ts"],
});
