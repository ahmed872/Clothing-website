/**
 * Which result URLs a try-on job may store and show (clothing P05).
 *
 * A provider's result URL ends up as an image source on the customer's
 * page, so it is treated as untrusted input even from a verified provider:
 * a compromised or misbehaving provider — or a forged callback that somehow
 * verified — must not be able to point the page at `javascript:`, a data
 * URI, plain HTTP, or a host the operator never approved.
 *
 * The rule is an allowlist, not a blocklist: HTTPS, no credentials, the
 * default port, and a hostname that is *exactly* one the operator listed in
 * `AI_TRYON_RESULT_HOSTS`. No suffix or wildcard matching —
 * `cdn.example.com.attacker.net` is not `cdn.example.com`.
 */

export const MAX_RESULT_URL_LENGTH = 2048;

/** Parses `AI_TRYON_RESULT_HOSTS` ("a.example.com, b.example.com"). */
export function parseResultHosts(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

export function isAllowedResultUrl(url: string, allowedHosts: readonly string[]): boolean {
  if (url.length === 0 || url.length > MAX_RESULT_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port !== '') return false;
  return allowedHosts.includes(parsed.hostname.toLowerCase());
}
