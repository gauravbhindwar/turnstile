// Minimal SSRF guard for the Action API's proxy_http mode. Blocks the
// obvious internal targets (loopback, RFC1918, link-local incl. the cloud
// metadata IP) by hostname pattern. This is NOT the full SSRF containment
// spec §17.3 describes for the forward proxy (DNS-rebinding-safe resolve-
// then-connect with IP pinning) — that lands with the forward proxy in M4.
// Good enough to stop naive "point it at 169.254.169.254" abuse today.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local, incl. cloud metadata endpoints
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd00:/i,
];

export class SsrfBlockedError extends Error {}

export function assertPublicHttpTarget(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`not a valid URL: "${rawUrl}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`unsupported protocol "${url.protocol}"`);
  }
  // URL.hostname keeps the brackets for IPv6 literals ("[::1]"), which none
  // of the patterns above account for — strip them before matching.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new SsrfBlockedError(`target host "${hostname}" is not allowed (private/loopback/link-local)`);
  }
}
