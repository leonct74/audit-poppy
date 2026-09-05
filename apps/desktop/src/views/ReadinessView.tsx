/**
 * Readiness — the scan + gap report (DESIGN §2.1). Three faces, all derived
 * from live state on every mount (AGENTS.md §5 — leave and come back, you
 * land on the truth):
 *   1. not auditing yet → the start panel (services, live costs, helper prompt)
 *   2. warming up      → "the audit is warming up", NEVER an empty-clean report
 *   3. running       → the gap report, grouped by Trust Services Criteria
 */
import { useCallback, useEffect, useState } from "react";
import type { GapReport } from "@auditpoppy/core";
import { api, type CostsResponse, type StatusResponse } from "../lib/api";
import { host } from "../lib/host";
import { buildHelperPrompt } from "../lib/helperPrompt";
import { CHECK_SERVICES } from "../lib/optionCatalog";
import { Banner, Chip, friendlyError, PendingButton } from "../ui";

const complianceChip = (c: string): { kind: "ok" | "warn" | "danger" | undefined; label: string } => {
  switch (c) {
    case "PASSED":
      return { kind: "ok", label: "pass" };
    case "FAILED":
      return { kind: "danger", label: "FAIL" };
    case "WARNING":
      return { kind: "warn", label: "warning" };
    case "NO_DATA":
      return { kind: undefined, label: "no data yet" };
    default:
      return { kind: undefined, label: "not available" };
  }
};

function HelperBanner() {
  const [copied, setCopied] = useState(false);
  return (
    <Banner kind="info">
      <div style={{ flex: 1 }}>
        <div style={{ marginBottom: 6 }}>
          Not sure what to enable or answer? Copy the helper prompt, paste it into the AI you already use, and
          add one sentence about your company — it answers with exactly what to tick and type here.
        </div>
        <button
          type="button"
          className={`btn btn-primary btn-sm${copied ? "" : " poppy-helper-pulse"}`}
          onClick={() => {
            void navigator.clipboard.writeText(buildHelperPrompt()).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied ✓" : "Copy the helper prompt"}
        </button>
      </div>
    </Banner>
  );
}

function EnablePanel(props: { status: StatusResponse; onStarted: () => void }) {
  const [costs, setCosts] = useState<CostsResponse | null>(null);
  const [costsError, setCostsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .costs()
      .then(setCosts)
      .catch((err: unknown) => setCostsError(friendlyError(err)));
  }, []);

  const ledgerPre = new Set(props.status.ledger.entries.filter((e) => e.preExisting).map((e) => e.service));

  return (
    <>
      <HelperBanner />
      <div className="card">
        <h2>Start auditing your account</h2>
        <p className="small muted2" style={{ marginTop: 0 }}>
          AuditPoppy examines your cloud account against the SOC 2 Trust Services Criteria and shows you
          every gap it finds — what an auditor would ask about, before they ask. To do that it needs two
          services switched on in your own account
          {costs ? `, sized against the ~${costs.resourceCount.toLocaleString("en-US")} resources found there` : ""}.
          Nothing is enabled until you approve it here, and it reads your estate — it never changes it.
        </p>
        {CHECK_SERVICES.map((service) => {
          const item = costs?.estimate.items.find((i) => i.service === service.id);
          const pre = service.id === "config" ? ledgerPre.has("config-recorder") : ledgerPre.has("securityhub");
          return (
            <div key={service.id} style={{ borderTop: "1px solid var(--poppy-border)", padding: "10px 0" }}>
              <div className="spread">
                <strong>{service.label}</strong>
                {pre ? (
                  <Chip kind="accent">already on — not ours, never touched</Chip>
                ) : item ? (
                  <span className="small">
                    est. <strong>${item.monthlyUsd.toFixed(2)}/month</strong>
                    {costs?.approxFallback || item.source === "approx" ? <span className="muted"> (approx)</span> : null}
                  </span>
                ) : costsError ? (
                  <span className="small muted">estimate unavailable</span>
                ) : (
                  <span className="small muted">estimating…</span>
                )}
              </div>
              <div className="small muted2">{service.what}</div>
              <div className="small muted">{service.caution}</div>
              {item ? <div className="small muted">{item.detail}</div> : null}
            </div>
          );
        })}
        {costsError ? <Banner kind="warn">{costsError}</Banner> : null}
        <p className="small muted2">
          Order matters: the change record starts first, then the audit checks — and both are recorded in the
          ledger so removal can disable exactly what was enabled here, nothing else.
        </p>
        {error ? <Banner kind="danger">{error}</Banner> : null}
        <PendingButton
          className="btn btn-primary"
          busyLabel="Starting…"
          onClick={async () => {
            setError(null);
            try {
              const access = await host.ensureAccess();
              if (access !== "granted") {
                setError("AgentsPoppy hasn't granted access to your cloud account yet — approve AuditPoppy's connection and try again.");
                return;
              }
              await api.enable();
              props.onStarted();
            } catch (err) {
              setError(friendlyError(err));
            }
          }}
        >
          Start auditing your account
        </PendingButton>
        {/* The button names the GOAL; this line names the consequence — which account changes, what
            it costs, and how to undo it. Founder review 2026-09-05: "check.. check what?" — the old
            label named our machinery, so the one button that changes an account read as jargon. */}
        <div className="small muted" style={{ marginTop: 8 }}>
          Switches on AWS Config and AWS Security Hub in account{" "}
          <span className="mono">{props.status.account ?? "—"}</span> ({props.status.region}). First scan takes a
          few hours to fill in; you can leave this screen. Turn it off any time from the Costs tab.
        </div>
      </div>
    </>
  );
}

function ReportView(props: { report: GapReport }) {
  const { report } = props;
  const t = report.totals;
  return (
    <>
      {report.warmingUp ? (
        <Banner kind="warn">
          <div>
            <strong>The audit is warming up.</strong> Your cloud provider is still enabling controls and running first
            evaluations — results below are partial by construction, not a clean bill. Come back in a few
            hours; the report fills in on its own.
          </div>
        </Banner>
      ) : null}
      <div className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Gap report</h2>
          <span className="small muted2">
            <Chip kind="danger">{t.failed} failing</Chip> <Chip kind="warn">{t.warning} warnings</Chip>{" "}
            <Chip kind="ok">{t.passed} passing</Chip> <Chip>{t.noData} awaiting data</Chip>
          </span>
        </div>
        <div className="small muted">
          Grouped by the SOC 2 Trust Services Criteria your auditor walks. Mapping {report.mappingVersion} ·
          generated {new Date(report.generatedAt).toLocaleString()} · account{" "}
          <span className="mono">{report.accountId}</span> ({report.region})
        </div>
      </div>
      {report.groups.map((group) => (
        <div className="card" key={group.tsc}>
          <h2>
            {group.tsc} — {group.name}
          </h2>
          <div className="small muted2">{group.description}</div>
          <ul className="control-list">
            {group.controls.map((c) => {
              const chip = complianceChip(c.compliance);
              return (
                <li key={`${c.standard}:${c.controlId}`}>
                  <div className="row">
                    <Chip kind={chip.kind}>{chip.label}</Chip>
                    <span className="mono">{c.controlId}</span>
                    <span>{c.title}</span>
                    {!c.enabled ? <Chip>disabled in Security Hub</Chip> : null}
                  </div>
                  {c.auditorNote ? <div className="small muted2">Why an auditor cares: {c.auditorNote}</div> : null}
                  {c.compliance === "FAILED" && c.fix ? <div className="small">Fix: {c.fix}</div> : null}
                  {c.failedResources?.length ? (
                    <div className="mono muted small">Affected: {c.failedResources.join(", ")}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {report.unmapped.length > 0 ? (
        <div className="card">
          <h2>Not yet in the criteria mapping</h2>
          <div className="small muted2">
            Your cloud provider added or renamed these checks after mapping {report.mappingVersion}; they still count, and a
            mapping update will file them under their criteria.
          </div>
          <ul className="control-list">
            {report.unmapped.map((c) => {
              const chip = complianceChip(c.compliance);
              return (
                <li key={`${c.standard}:${c.controlId}`} className="row">
                  <Chip kind={chip.kind}>{chip.label}</Chip>
                  <span className="mono">{c.controlId}</span>
                  <span>{c.title}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export function ReadinessView(props: { status: StatusResponse; refreshStatus: () => void }) {
  const { status } = props;
  const [report, setReport] = useState<GapReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const readiness = status.readiness && "standards" in status.readiness ? status.readiness : null;
  const checksOn = readiness ? readiness.standards.some((s) => s.status !== "NOT_ENABLED") : false;
  const enabling = !!status.enableOp && !status.enableOp.finishedAt && !status.enableOp.error;

  const loadReport = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .report()
      .then(setReport)
      .catch((err: unknown) => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (checksOn) loadReport();
  }, [checksOn, loadReport]);

  // While the enable flow runs in the background, keep the status fresh.
  useEffect(() => {
    if (!enabling) return;
    const timer = setInterval(props.refreshStatus, 4000);
    return () => clearInterval(timer);
  }, [enabling, props.refreshStatus]);

  if (status.readiness && "error" in status.readiness) {
    return <Banner kind="danger">{status.readiness.error}</Banner>;
  }

  if (enabling) {
    return (
      <div className="card">
        <h2>Starting the audit…</h2>
        <div className="progress-line">
          <span className="dot busy" /> The change record first, then the audit checks and their two
          catalogues.
        </div>
        <p className="small muted2">
          This runs in the background — leave, close, come back: it continues, and this screen picks up the
          live state. First results take a while to generate; the report will say "warming up" until then.
        </p>
      </div>
    );
  }

  if (status.enableOp?.error) {
    return (
      <>
        <Banner kind="danger">Starting the audit hit a problem: {status.enableOp.error}</Banner>
        <PendingButton
          className="btn btn-primary"
          busyLabel="Retrying…"
          onClick={async () => {
            await api.enable();
            props.refreshStatus();
          }}
        >
          Try again
        </PendingButton>
      </>
    );
  }

  if (!checksOn) {
    return <EnablePanel status={status} onStarted={props.refreshStatus} />;
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <PendingButton className="btn btn-sm" busyLabel="Refreshing…" onClick={async () => loadReport()}>
          Refresh report
        </PendingButton>
        {status.ledger.entries.some((e) => e.preExisting) ? (
          <span className="small muted">
            Some checking services were already on in this account — AuditPoppy reads them and will never
            touch them.
          </span>
        ) : null}
      </div>
      {error ? <Banner kind="danger">{error}</Banner> : null}
      {loading && !report ? (
        <div className="card row">
          <span className="spinner" /> Reading the audit results…
        </div>
      ) : null}
      {report ? <ReportView report={report} /> : null}
    </>
  );
}
