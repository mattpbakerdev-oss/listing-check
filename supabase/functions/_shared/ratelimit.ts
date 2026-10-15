// Rate-limit identity. The caller's IP is hashed with a server-side salt (RATE_LIMIT_SALT)
// before it is stored or compared, so rewrite_log holds nothing that identifies the caller
// and the hashes are useless without the secret. Shared by the edge function (Deno) and
// the Node tests; uses Web Crypto, which both have.

export function clientIpFrom(forwardedFor: string | null): string {
  return (forwardedFor ?? "").split(",")[0].trim() || "unknown";
}

export async function hashClient(ip: string, salt: string): Promise<string> {
  if (!salt) throw new Error("RATE_LIMIT_SALT is not set; refusing to hash without a salt");
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
