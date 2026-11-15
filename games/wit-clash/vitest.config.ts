import { uiTestConfig } from "@openparty/config/vitest";

export default uiTestConfig({
  name: "wit-clash",
  exclude: ["tests/game/**", "tests/bots/**", "tests/terminal/**"],
  coverage: ["src/**/*.ts", "ui/**/*.ts"],
});
