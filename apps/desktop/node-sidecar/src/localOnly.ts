/**
 * The one check that stands between this sidecar and every other process on the machine.
 *
 * WHY IT EXISTS. This backend listens on loopback and, until now, read exactly three things
 * from a request: method, path, body. No caller identity at all. AGENTS.md §12 is explicit
 * that "loopback is not a trust boundary — every poppy's backend is a local process too",
 * which is why the host checks a bearer token on every request it receives. This hop did not,
 * so anything running as the user — a sibling poppy's backend included — could drive the whole
 * grant set without ever holding a credential: read the account id and every failing control,
 * mint an export download token, or POST /teardown and destroy the versioned evidence bucket.
 *
 * WHAT THIS CLOSES, AND WHAT IT DOES NOT. It closes the browser class completely, which is the
 * half a poppy can close on its own:
 *
 *   - A page cannot forge `Origin`. Every cross-origin fetch carries one, so requiring its
 *     ABSENCE rejects browser-driven requests without needing an allowlist to be right.
 *     (MailPoppy's "origin allowlist" is CORS response headers — it decides what a browser is
 *     told it may read, never who may call. It is not a precedent for authentication.)
 *   - A page cannot forge `Host` either, so pinning it to loopback kills DNS rebinding, where
 *     an attacker's domain resolves to 127.0.0.1 and the request stops being cross-origin.
 *
 * It does NOT close the local-process class: a peer process can send any headers it likes, so
 * it can simply omit Origin. Only a shared secret does that, and the secret has to come from
 * the host — see the note in index.ts. This is the floor, not the ceiling.
 *
 * NOTHING LEGITIMATE CARRIES AN ORIGIN. The frontend never talks to this port directly; it
 * calls host.invokeBackend, and the broker forwards server-side with undici, which sends no
 * Origin. The download route is opened by the system browser through the host's own /ext-dl/
 * proxy — again server-side. Verified against the platform's registry.ts before shipping this.
 */

/** Just the headers this decision reads — so a test needn't build an IncomingMessage. */
export interface RequestOrigin {
  host?: string | string[];
  origin?: string | string[];
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * True when a request may be served. Both conditions must hold:
 *   1. no Origin header at all — its presence means a browser sent this;
 *   2. Host names loopback — so a rebound hostname is refused even without an Origin.
 *
 * A missing Host is refused too: HTTP/1.1 requires it, so its absence is a hand-rolled client,
 * and defaulting to "allow" is how these checks fail open.
 */
export function isLocalRequest(headers: RequestOrigin): boolean {
  if (first(headers.origin) !== undefined) return false;
  const host = first(headers.host);
  if (host === undefined) return false;
  // Strip the port. IPv6 literals keep their brackets, which is why "[::1]" is in the set.
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? "");
  return LOOPBACK.has(name.toLowerCase());
}
