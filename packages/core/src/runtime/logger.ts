/** The level of a log line. */
export type LogLevel = "info" | "warn" | "error";

/**
 * The field map of a log line: strings, numbers or booleans only — never player names, payloads
 * or free text (see the framework guide's Logging section).
 */
export type LogFields = Record<string, string | number | boolean>;

/**
 * A structured log sink. Each call carries an event name and optional {@link LogFields}. Hosts
 * bind the room id and timestamp before writing.
 */
export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** One logged line as captured by `FakeHost.logs`. */
export interface LogLine {
  level: LogLevel;
  event: string;
  fields?: LogFields;
}

/**
 * The logger game code gets as `ctx.log`: call it for an `info` line, or use `.warn`/`.error`.
 */
export interface ContextLogger {
  (event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** A no-op logger, usable as a host sink (`RuntimeHost.log`) or a context logger (`GameContext.log`): drops every line. */
export const noopLogger: Logger & ContextLogger = Object.assign(() => {}, {
  info: () => {},
  warn: () => {},
  error: () => {},
});
