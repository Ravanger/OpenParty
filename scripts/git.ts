import { execFileSync } from "node:child_process";

/** Runs `git <args>` and returns stdout as text; inject a fake in tests. */
export type GitExec = (args: string[]) => string;

/** The real git binary, with a 256 MiB output cap. */
export const runGit: GitExec = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** `git diff` with the given arguments (flags plus range); inject `exec` in tests. */
export const gitDiff = (range: string[], exec: GitExec = runGit): string =>
  exec(["diff", ...range]);
