/**
 * AuditPoppy — SOC 2 audit-readiness in your own AWS. Five screens + the
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
import { ReadinessView } from "./views/ReadinessView";

const TABS = ["Readiness", "Evidence", "Policies", "Export", "Costs", "Feedback"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [tab, setTab] = useState<Tab>("Readiness");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            SOC 2 audit-readiness in your own AWS
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
          <span className="spinner" /> Connecting to your AWS account…
        </div>
      ) : null}

      {status ? (
        <>
          {tab === "Readiness" ? <ReadinessView status={status} refreshStatus={refreshStatus} /> : null}
          {tab === "Evidence" ? <EvidenceView status={status} refreshStatus={refreshStatus} /> : null}
          {tab === "Policies" ? <PoliciesView /> : null}
          {tab === "Export" ? <ExportView /> : null}
          {tab === "Costs" ? <CostsView status={status} refreshStatus={refreshStatus} /> : null}
        </>
      ) : null}
      {tab === "Feedback" ? <FeedbackView /> : null}
    </div>
  );
}
