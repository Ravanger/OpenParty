import { nodeTestConfig } from "@openparty/config/vitest";

export default nodeTestConfig({
  name: "@openparty/content",
  coverage: ["src/**/*.ts"],
});
