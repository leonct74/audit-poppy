/**
 * The host bridge, from the frontend side — the wire protocol every poppy
 * mirrors (postMessage { id, method, params } → { id, ok, result | error }).
 * The host honours only the capabilities extension.json declares.
 *
 * Developer mode (the tab served by Vite, no host frame): invokeBackend goes
 * through the dev proxy (/api → the local sidecar); host-only methods answer
 * with honest errors instead of hanging.
 */

export interface BackendInvoke {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

export interface PurchaseInfo {
  productId: string;
  name: string;
  price: {
    amountMinor: number;
    currency: string;
    kind: "one_time" | "subscription";
    interval?: "month" | "year";
    trialDays?: number;
  } | null;
  owned: boolean;
}

interface ConnectionLike {
  id?: string;
  status?: string;
  app?: { id?: string; name?: string };
}

const inHost = typeof window !== "undefined" && window.parent !== window;

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let seq = 0;

if (typeof window !== "undefined") {
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window.parent) return; // only trust the host frame
    const res = e.data as { id?: string; ok?: boolean; result?: unknown; error?: string };
    if (!res || typeof res.id !== "string") return;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.result);
    else p.reject(new Error(res.error ?? "host call failed"));
  });
}

function call<T>(method: string, ...params: unknown[]): Promise<T> {
  if (!inHost) {
    return Promise.reject(
      new Error("This needs the AgentsPoppy window — open AuditPoppy from your AgentsPoppy sidebar."),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const id = `req-${Date.now().toString(36)}-${++seq}`;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    window.parent.postMessage({ id, method, params }, "*");
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`the host didn't answer "${method}" in time`));
    }, 60_000);
  });
}

async function devInvoke<T>(req: BackendInvoke): Promise<T> {
  const res = await fetch(`/api${req.path}`, {
    method: req.method,
    headers: req.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  });
  const body = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(body?.message ?? `backend answered ${res.status}`);
  return body;
}

export const host = {
  inHost,
  ensureAccess: (): Promise<"granted" | "pending" | "denied"> =>
    inHost ? call("ensureAccess") : Promise.resolve("granted"),
  getConnection: (): Promise<ConnectionLike> => call("getConnection"),
  invokeBackend: <T>(req: BackendInvoke): Promise<T> => (inHost ? call<T>("invokeBackend", req) : devInvoke<T>(req)),
  // Dev mode runs in a real browser (not the host webview), where window.open
  // works — so downloads and links stay testable without AgentsPoppy.
  openExternal: (url: string): Promise<void> => {
    if (inHost) return call("openExternal", url);
    window.open(url, "_blank", "noopener");
    return Promise.resolve();
  },
  notify: (n: { title: string; body?: string }): Promise<void> =>
    inHost ? call("notify", n) : Promise.resolve(console.info(`[notify] ${n.title}`, n.body ?? "")),
  purchaseInfo: (productId: string): Promise<PurchaseInfo> => call("purchaseInfo", productId),
  buyProduct: (productId: string): Promise<{ owned: boolean }> => call("buyProduct", productId),
  isPurchased: (productId: string): Promise<boolean> => (inHost ? call("isPurchased", productId) : Promise.resolve(false)),
  manageSubscription: (productId: string): Promise<void> => call("manageSubscription", productId),
};

/** The broker serves our tab and downloads from one origin; a one-shot
 *  sidecar download is opened through it in the system browser. In dev mode
 *  the Vite proxy reaches the sidecar's route directly. */
export function downloadUrl(token: string): string {
  return inHost
    ? `${window.location.origin}/ext-dl/com.auditpoppy.desktop/local-download/${token}`
    : `${window.location.origin}/api/local-download/${token}`;
}
