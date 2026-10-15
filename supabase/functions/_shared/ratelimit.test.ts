// The rate limiter stores a salted hash of the caller's IP, never the IP. Written before the implementation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hashClient, clientIpFrom } from "./ratelimit.ts";

const SALT = "test-salt-not-secret";

describe("hashClient", () => {
  test("is deterministic for the same ip and salt", async () => {
    assert.equal(await hashClient("203.0.113.7", SALT), await hashClient("203.0.113.7", SALT));
  });
  test("is 64 hex characters (SHA-256)", async () => {
    assert.match(await hashClient("203.0.113.7", SALT), /^[0-9a-f]{64}$/);
  });
  test("is hex only, so it cannot contain an address", async () => {
    const h = await hashClient("203.0.113.7", SALT);
    assert.equal(h.includes("203.0.113.7"), false);
    assert.equal(/[^0-9a-f]/.test(h), false);
  });
  test("a different salt gives a different hash, so the hashes are useless without the secret", async () => {
    assert.notEqual(await hashClient("203.0.113.7", SALT), await hashClient("203.0.113.7", "another-salt"));
  });
  test("different ips give different hashes", async () => {
    assert.notEqual(await hashClient("203.0.113.7", SALT), await hashClient("203.0.113.8", SALT));
  });
  test("refuses an empty salt rather than hashing weakly", async () => {
    await assert.rejects(() => hashClient("203.0.113.7", ""), /RATE_LIMIT_SALT/);
  });
});

describe("clientIpFrom", () => {
  test("takes the first address in x-forwarded-for", () => {
    assert.equal(clientIpFrom("203.0.113.7, 10.0.0.1"), "203.0.113.7");
  });
  test("falls back to 'unknown' when there is no header", () => {
    assert.equal(clientIpFrom(null), "unknown");
    assert.equal(clientIpFrom(""), "unknown");
  });
});
