import { nodeTestConfig } from "@openparty/config/vitest";

export default nodeTestConfig({
  name: "@openparty/terminal",
  coverage: ["src/**/*.ts"],
});
