/**
 * Helpers that strip sensitive data out of strings before they are ever
 * logged or included in an error message. Apify and CDN video URLs are
 * frequently "signed" -- their query string contains time-limited
 * authentication tokens that are effectively secrets and must never be
 * printed in full.
 */

/**
 * Reduces a URL down to "protocol//host/path" and drops the query string
 * and fragment, so logs stay useful for debugging (which host? which
 * route?) without ever exposing signed tokens. Falls back to a fixed
 * placeholder if the input isn't a parseable URL at all.
 */
export function sanitizeUrlForLogging(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "[unparseable url]";
  }
}

/**
 * Defensive redaction for free-form text (e.g. error messages bubbled up
 * from a dependency) that might accidentally contain a query string with
 * an auth-looking parameter. This is a best-effort net, not a guarantee --
 * the real safeguard is simply never passing secrets into logged strings.
 */
export function redactQueryStrings(text: string): string {
  return text.replace(/(\?[^\s"')]+)/g, "?[redacted]");
}
