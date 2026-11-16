import {
  ACTION_LOG_ENTRY_KINDS,
  type ActionLog,
  ActionLogSchema,
  MAX_ACTION_LOG_ENTRIES,
} from "../actionLog.js";
import { required } from "../utils.js";

/** The fields of a schema issue this mapper reads. */
interface ShapeIssue {
  code: string;
  path: readonly PropertyKey[];
}

/** The integer range of each bounded numeric field, for out-of-range shape messages. */
const FIELD_RANGES: Record<string, readonly [number, number]> = {
  t: [0, Number.MAX_SAFE_INTEGER],
  seq: [1, Number.MAX_SAFE_INTEGER],
  startedAt: [0, Number.MAX_SAFE_INTEGER],
  ticks: [0, Number.MAX_SAFE_INTEGER],
};

/** The "must be" text for a field, naming its integer range when the issue is an out-of-range value. */
function mustBe(field: string, code: string, typeText: string): string {
  const range = FIELD_RANGES[field];
  if (range !== undefined && (code === "too_small" || code === "too_big")) {
    return `an integer between ${range[0]} and ${range[1]}`;
  }
  return typeText;
}

/** The type text for an entry field in a shape error. */
function entryFieldType(field: string): string {
  switch (field) {
    case "kind":
      return `one of ${ACTION_LOG_ENTRY_KINDS.join(", ")}`;
    case "t":
    case "seq":
    case "ticks":
      return "a number";
    case "payload":
      return "a plain object";
    case "rejected":
    case "redacted":
      return "a boolean";
    default:
      return "a string";
  }
}

/** The type text for a header field in a shape error. */
function headerFieldType(field: string): string {
  switch (field) {
    case "seed":
      return "an array of 4 numbers";
    case "startedAt":
      return "a number";
    default:
      return "a string";
  }
}

/** The type text for a roster field in a shape error. */
function rosterFieldType(field: string): string {
  switch (field) {
    case "id":
      return "a string";
    default:
      return "a boolean";
  }
}

/** Describes the first {@link ActionLogSchema} issue as a named `replayLog:` message. */
function shapeMessage(issues: readonly ShapeIssue[], log: unknown): string {
  const issue = required(issues[0], "shape issue");
  const [section, index, field] = issue.path;
  if (section === "entries") {
    if (typeof index !== "number") {
      return issue.code === "too_big"
        ? `log.entries has more than ${MAX_ACTION_LOG_ENTRIES} entries`
        : "log.entries must be an array";
    }
    // A path of ["entries", i] means the schema saw an array there, so this cannot miss.
    const entry = (log as { entries: readonly unknown[] }).entries[index];
    if (field === undefined) {
      return issue.code === "unrecognized_keys"
        ? `malformed log entry ${JSON.stringify(entry)}: has unrecognized fields`
        : `malformed log entry ${JSON.stringify(entry)}: must be an object`;
    }
    return `malformed log entry ${JSON.stringify(entry)}: "${String(field)}" must be ${mustBe(String(field), issue.code, entryFieldType(String(field)))}`;
  }
  if (section === "header") {
    if (index === undefined) {
      return issue.code === "unrecognized_keys"
        ? "log.header has unrecognized fields"
        : "log.header must be an object";
    }
    return `log.header.${String(index)} must be ${mustBe(String(index), issue.code, headerFieldType(String(index)))}`;
  }
  if (section === "roster") {
    if (typeof index !== "number") return "log.roster must be an array";
    const seat = (log as { roster: readonly unknown[] }).roster[index];
    if (field === undefined) {
      return issue.code === "unrecognized_keys"
        ? `malformed roster entry ${JSON.stringify(seat)}: has unrecognized fields`
        : `malformed roster entry ${JSON.stringify(seat)}: "id" must be a string`;
    }
    return `malformed roster entry ${JSON.stringify(seat)}: "${String(field)}" must be ${rosterFieldType(String(field))}`;
  }
  return issue.code === "unrecognized_keys"
    ? "log has unrecognized fields"
    : "log must be an object";
}

/** Validates the log's shape so a corrupt log fails with a named `replayLog:` error, never a raw `TypeError`. */
export function assertLogShape(log: ActionLog): void {
  const parsed = ActionLogSchema.safeParse(log);
  if (parsed.success) return;
  throw new Error(`replayLog: ${shapeMessage(parsed.error.issues, log)}`);
}
