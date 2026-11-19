import { checkPaths, parseNameStatus } from "./checkPaths.js";
import { gitDiff } from "./git.js";

const [flag, ref] = process.argv.slice(2);
const range =
  flag === "--staged" ? ["--cached"] : flag === "--base" && ref ? [`${ref}...HEAD`] : [];
if (range.length === 0) {
  console.error("usage: checkPathsCli.ts --staged | --base <ref>");
  process.exit(2);
}

const output = gitDiff(["--name-status", ...range]);
const violations = checkPaths(parseNameStatus(output));
for (const v of violations) {
  console.error(`${v.path}: ${v.message}`);
}
process.exit(violations.length > 0 ? 1 : 0);
