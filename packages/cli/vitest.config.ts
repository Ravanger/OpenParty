import { nodeTestConfig } from "@openparty/config/vitest";

export default nodeTestConfig({
  name: "cli",
  coverage: ["src/**/*.ts"],
});
