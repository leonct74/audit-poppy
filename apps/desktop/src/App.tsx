/**
 * AuditPoppy — SOC 2 audit-readiness in your own cloud. Six screens + the
 * mandatory Feedback tab (last). Status is fetched from the sidecar on mount
 * and after every state-changing action, so a remount lands on live truth.
 */
import { useCallback, useEffect, useState } from "react";
import iconUrl from "./assets/auditpoppy-icon.png";
import { api, type StatusResponse } from "./lib/api";
import { Banner, friendlyError } from "./ui";
import { CostsView } from "./views/CostsView";
import { EvidenceView } from "./views/EvidenceView";
import { ExportView } from "./views/ExportView";
import { FeedbackView } from "./views/FeedbackView";
import { PoliciesView } from "./views/PoliciesView";
import { RemovePanel } from "./views/RemovePanel";
import { ReadinessView } from "./views/ReadinessView";

// Remove is its own tab because it could not be found where it was. It lived at the bottom of
// Costs — removal next to the off switch and the bill, which reads well in a design document —
// and the founder, who specified that, looked for it and failed twice (2026-09-07, 2026-09-10).
// A destructive action nobody can find is not "safely tucked away", it is missing: the person
// hunting for it has already decided, and what they do instead is worse.
// Feedback stays LAST (AGENTS.md §9a) — tabs.test.ts pins both facts.
const TABS = ["Readiness", "Evidence", "Policies", "Export", "Costs", "Remove", "Feedback"] as const;
type Tab = (typeof TABS)[number];

/** Is the audit on? Unknown counts as ON — never read silence as "nothing is running". */
function auditRunning(status: StatusResponse): boolean {
  const readiness = status.readiness && "standards" in status.readiness ? status.readiness : null;
  // The panel uses this only to OFFER the gentler route ("stop first, it is reversible"), so a
  // wrong guess costs a sentence rather than a mistake — but guess in the safe direction anyway.
  return readiness ? readiness.standards.some((s) => s.status !== "NOT_ENABLED") : true;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("Readiness");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Removal deletes the evidence bucket, so it asks for an export first (DESIGN §3).
  const [exported, setExported] = useState(false);

  const refreshStatus = useCallback(() => {
    api
      .status()
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((err: unknown) => setError(friendlyError(err)));
  }, []);

  useEffect(refreshStatus, [refreshStatus]);

  return (
    <div className="app">
      <header className="app-header">
        <img src={iconUrl} alt="" />
        <div>
          <h1>AuditPoppy</h1>
          <div className="sub">
            SOC 2 audit-readiness in your own cloud
            {status?.account ? (
              <>
                {" · "}
                <span className="mono">{status.account}</span> ({status.region})
              </>
            ) : null}
          </div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} type="button" className={`tab${t === tab ? " active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {error ? (
        <Banner kind="warn">
          <div>
            {error}{" "}
            <button type="button" className="btn btn-ghost btn-sm" onClick={refreshStatus}>
              Retry
            </button>
          </div>
        </Banner>
      ) : null}

      {!status && !error ? (
        <div className="card row">
          <span className="spinner" /> Connecting to your cloud account…
        </div>
      ) : null}

      {status ? (
        <>
          {tab === "Readiness" ? <ReadinessView status={status} refreshStatus={refreshStatus} /> : null}
          {tab === "Evidence" ? <EvidenceView status={status} refreshStatus={refreshStatus} /> : null}
          {tab === "Policies" ? <PoliciesView /> : null}
          {tab === "Export" ? <ExportView accountId={status.account} onExported={() => setExported(true)} /> : null}
          {tab === "Costs" ? <CostsView status={status} refreshStatus={refreshStatus} /> : null}
          {tab === "Remove" ? (
            <RemovePanel
              accountId={status.account}
              exportedThisSession={exported}
              auditRunning={auditRunning(status)}
              refreshStatus={refreshStatus}
            />
          ) : null}
        </>
      ) : null}
      {tab === "Feedback" ? <FeedbackView /> : null}
    </div>
  );
}
