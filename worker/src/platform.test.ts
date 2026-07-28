/**
 * Lightweight validation script for platform detection, using Node's
 * built-in test runner (`node:test`) so no extra test framework dependency
 * is needed. Run with `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform } from "./platform.js";
import { isAppError } from "./utils/errors.js";

const ACCEPTED: Array<{ url: string; platform: "instagram" | "tiktok" }> = [
  { url: "https://www.instagram.com/reel/ABC123/", platform: "instagram" },
  { url: "https://instagram.com/p/ABC123/", platform: "instagram" },
  { url: "https://www.tiktok.com/@creator/video/123456789", platform: "tiktok" },
  { url: "https://vm.tiktok.com/ABC123/", platform: "tiktok" },
];

const REJECTED: string[] = [
  "https://instagram.com.example.com/reel/ABC123/",
  "https://tiktok.com.example.com/video/123/",
  "https://example.com/",
  "not-a-url",
  "ftp://www.instagram.com/reel/ABC123/",
];

for (const { url, platform } of ACCEPTED) {
  test(`accepts ${url}`, () => {
    const result = detectPlatform(url);
    assert.equal(result.platform, platform);
  });
}

for (const url of REJECTED) {
  test(`rejects ${url}`, () => {
    assert.throws(() => detectPlatform(url), (err: unknown) => isAppError(err));
  });
}

test("rejects URLs with embedded credentials", () => {
  assert.throws(
    () => detectPlatform("https://user:pass@www.instagram.com/reel/ABC123/"),
    (err: unknown) => isAppError(err),
  );
});

test("rejects Instagram profile URLs (not a video/reel path)", () => {
  assert.throws(
    () => detectPlatform("https://www.instagram.com/someusername/"),
    (err: unknown) => isAppError(err),
  );
});
