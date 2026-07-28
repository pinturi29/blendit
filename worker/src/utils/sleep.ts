/** Promise-based delay, used by the Claude analysis retry-with-backoff loop. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
