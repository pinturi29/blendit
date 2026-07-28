/**
 * Tiny terminal logger. We deliberately avoid pulling in a logging
 * framework (per project requirements) -- this program only ever needs
 * four message types, printed to stdout/stderr with a short prefix.
 *
 * IMPORTANT: callers must never pass secrets (API tokens, signed URLs,
 * raw third-party API responses) to these methods. See utils/sanitize.ts
 * for helpers that strip sensitive parts out of URLs before logging.
 */

/* Minimal ANSI color codes -- no dependency needed, and terminals that
   don't support color just show the codes' surrounding text unaffected
   (most modern terminals handle this fine; this is optional polish). */
const COLOR = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function write(stream: NodeJS.WriteStream, prefix: string, color: string, message: string): void {
  stream.write(`${color}${prefix}${COLOR.reset} ${message}\n`);
}

export const logger = {
  info(message: string): void {
    write(process.stdout, "[INFO]", COLOR.gray, message);
  },
  success(message: string): void {
    write(process.stdout, "[OK]", COLOR.green, message);
  },
  warn(message: string): void {
    write(process.stderr, "[WARN]", COLOR.yellow, message);
  },
  error(message: string): void {
    write(process.stderr, "[ERROR]", COLOR.red, message);
  },
  /** Plain, un-prefixed line -- used for the banner and the final summary. */
  plain(message: string): void {
    process.stdout.write(`${message}\n`);
  },
};
