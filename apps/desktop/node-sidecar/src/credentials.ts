/**
 * Scoped-credential minting against the host's injected credentialsUrl —
 * short-lived, auto-rotating, tag-scoped; never the operator's own keys.
 * Supervised connections answer 202 { approval } until the user decides in
 * AgentsPoppy; we poll, honouring a genuine denial (MailPoppy pattern).
 */
import type { BackendBootstrap } from "./bootstrap";

export interface AwsCredentialIdentity {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}
export type CredentialProvider = () => Promise<AwsCredentialIdentity>;

interface ScopedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

const REFRESH_BUFFER_MS = 300_000; // re-mint 5 min before expiry
const APPROVAL_POLL_MS = 2000;

function isScopedCredentials(v: unknown): v is ScopedCredentials {
  const c = v as Partial<ScopedCredentials> | null;
  return !!c && !!c.accessKeyId && !!c.secretAccessKey && !!c.sessionToken && !!c.expiration;
}

async function mint(bootstrap: BackendBootstrap): Promise<ScopedCredentials> {
  const post = (body?: unknown): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (bootstrap.credentialsToken) headers["authorization"] = `Bearer ${bootstrap.credentialsToken}`;
    return fetch(bootstrap.credentialsUrl, {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await post();
  for (;;) {
    if (!res.ok) {
      let message = `AgentsPoppy returned ${res.status} while minting credentials`;
      try {
        const b = (await res.json()) as { message?: string };
        if (b?.message) message = b.message;
      } catch {
        /* keep status-based message */
      }
      // A lapsed/consumed approval isn't a "no" — re-request and keep waiting.
      if (/expired|already been used|request again/i.test(message)) {
        await new Promise((r) => setTimeout(r, APPROVAL_POLL_MS));
        res = await post();
        continue;
      }
      throw new Error(message);
    }
    const body: unknown = await res.json();
    if (isScopedCredentials(body)) return body;
    const approvalId = (body as { approval?: { id?: string } }).approval?.id;
    if (!approvalId) throw new Error("AgentsPoppy returned an unexpected credentials response");
    await new Promise((r) => setTimeout(r, APPROVAL_POLL_MS));
    res = await post({ approvalId });
  }
}

/** A caching, auto-refreshing provider for the AWS SDK's `credentials` option. */
export function makeCredentialProvider(bootstrap: BackendBootstrap): CredentialProvider {
  let cached: ScopedCredentials | null = null;
  let inflight: Promise<ScopedCredentials> | null = null;
  const fresh = (c: ScopedCredentials): boolean => {
    const exp = Date.parse(c.expiration);
    return Number.isFinite(exp) && Date.now() < exp - REFRESH_BUFFER_MS;
  };
  const refresh = (): Promise<ScopedCredentials> => {
    inflight ??= mint(bootstrap)
      .then((c) => {
        cached = c;
        return c;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
  return async () => {
    const c = cached && fresh(cached) ? cached : await refresh();
    return {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
      sessionToken: c.sessionToken,
      expiration: new Date(c.expiration),
    };
  };
}
