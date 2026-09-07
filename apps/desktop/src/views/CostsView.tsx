/**
 * Costs — DESIGN §7, the GuardDuty precedent + the founder's free-trial rule:
 * itemized live estimates from the account's real shape, the trial's END DATE
 * with the expected cost AFTER it, and the disable switch RIGHT NEXT to that
 * line. The $0 state is celebrated, not implied. Account-wide billed actuals
 * stay the host's job (Cost Explorer) — this screen totals OUR services only.
 */
import { useEffect, useState } from "react";
import { api, type CostsResponse, type StatusResponse } from "../lib/api";
import { Banner, Chip, friendlyError, PendingButton, TypeToConfirm } from "../ui";
import { RemovePanel } from "./RemovePanel";

const SERVICE_LABEL: Record<string, string> = {
  config: "AWS Config — the change record",
  securityhub: "AWS Security Hub — the audit checks",
  evidence: "Evidence bucket + monthly snapshot",
};

export function CostsView(props: { status: StatusResponse; refreshStatus: () => void; exportedThisSession?: boolean }) {
  const [costs, setCosts] = useState<CostsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [disabledReport, setDisabledReport] = useState<string | null>(null);

  useEffect(() => {
    api
      .costs()
      .then(setCosts)
      .catch((err: unknown) => setError(friendlyError(err)));
  }, []);

  const readiness = props.status.readiness && "standards" in props.status.readiness ? props.status.readiness : null;
  const checksOn = readiness ? readiness.standards.some((s) => s.status !== "NOT_ENABLED") : false;
  const oursOn = props.status.ledger.entries.some((e) => !e.preExisting);
  const trial = costs?.freeTrial ?? props.status.freeTrial;
  const monthly = costs?.estimate.totalMonthlyUsd;

  if (error) return <Banner kind="danger">{error}</Banner>;

  return (
    <>
      {!checksOn ? (
        <Banner kind="ok">
          <div>
            <strong>$0 — nothing running, nothing billing.</strong> No checking service is enabled and no
            stack is deployed{oursOn ? "" : " by AuditPoppy"}. Costs start only when you turn things on, and
            each line below shows what they would be.
          </div>
        </Banner>
      ) : null}

      <div className="card">
        <h2>What the checking services cost</h2>
        {!costs ? (
          <div className="row small muted">
            <span className="spinner" /> Computing from your account's real size…
          </div>
        ) : (
          <>
            <p className="small muted2" style={{ marginTop: 0 }}>
              Computed from ~{costs.resourceCount.toLocaleString("en-US")} resources found in your account.
              {costs.approxFallback
                ? " Live prices weren't reachable just now, so these use approximate rates — clearly not live."
                : " Rates fetched live from your cloud provider's price list."}{" "}
              Billed by your cloud provider in your own account; AuditPoppy adds nothing on top.
            </p>
            <ul className="control-list">
              {costs.estimate.items.map((item) => (
                <li key={item.service}>
                  <div className="spread">
                    <strong>{SERVICE_LABEL[item.service] ?? item.service}</strong>
                    <span>
                      ≈ ${item.monthlyUsd.toFixed(2)}/month
                      {item.source === "approx" ? <span className="muted small"> (approx)</span> : null}
                    </span>
                  </div>
                  <div className="small muted">{item.detail}</div>
                </li>
              ))}
            </ul>
            <div className="spread" style={{ borderTop: "1px solid var(--poppy-border)", paddingTop: 8 }}>
              <strong>Total while enabled</strong>
              <strong>≈ ${costs.estimate.totalMonthlyUsd.toFixed(2)}/month</strong>
            </div>
            {/* The monthly figure alone reads as "so a short trial is nearly free" — and that is
                wrong in a way that ends in a surprise bill. Config charges per recorded item, and
                turning the recorder on records every resource you have straight away. Say it
                where the number is, not in a footnote. */}
            <div className="spread" style={{ paddingTop: 6 }}>
              <span className="small">
                <strong>Charged as soon as you turn it on</strong>
                <div className="muted">
                  Cloud config recording bills per recorded item, not per hour — switching it on records every
                  resource you have once, right away. Turning it off five minutes later doesn't avoid this part.
                </div>
              </span>
              <strong className="small">
                ≈ ${costs.estimate.initialUsd.toFixed(2)} once
                {costs.estimate.source === "approx" ? <span className="muted"> (approx)</span> : null}
              </strong>
            </div>
          </>
        )}
      </div>

      {checksOn && trial && !trial.expired ? (
        <div className="card">
          <div className="spread">
            <div>
              <strong>Security Hub free trial ends on {trial.endsOn}</strong> ({trial.daysLeft} days left).
              <div className="small muted2">
                Expected cost after that: {monthly !== undefined ? `≈ $${monthly.toFixed(2)}/month` : "shown above"} while
                enabled. Nothing converts silently — the switch is right here.
              </div>
            </div>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming(true)}>
              Stop auditing
            </button>
          </div>
        </div>
      ) : null}

      {checksOn && (!trial || trial.expired) ? (
        <div className="card spread">
          <div className="small muted2">
            The audit is running{trial?.expired ? " and the free trial has ended" : ""} — the estimate above
            is what they cost while enabled.
          </div>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming(true)}>
            Stop auditing
          </button>
        </div>
      ) : null}

      {confirming ? (
        <TypeToConfirm
          word="stop auditing"
          blastRadius={
            <>
              This stops the audit and disables what AuditPoppy enabled: the Security Hub checks and the Config change record.
              New findings and change history stop accruing (billing for them stops too). Anything that
              was already on before AuditPoppy is <strong>not</strong> touched. Your evidence bucket, its
              bundles and the stack all stay — this is not removal.
            </>
          }
          actionLabel="Stop auditing"
          busyLabel="Disabling…"
          onConfirm={async () => {
            setError(null);
            try {
              const report = await api.disableChecks();
              setDisabledReport(
                report.problems.length > 0
                  ? `Disabled with warnings: ${report.problems.join("; ")}`
                  : `Disabled: ${report.disabled.join(", ") || "nothing was ours to disable"}.`,
              );
              setConfirming(false);
              props.refreshStatus();
            } catch (err) {
              setError(friendlyError(err));
            }
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      {disabledReport ? <Banner kind="ok">{disabledReport}</Banner> : null}

      <p className="small muted">
        Your account-wide cloud bill (all services, month to date) lives in the AgentsPoppy Dashboard — this
        screen totals only what AuditPoppy itself would enable.
      </p>

      {/* Removal lives below the off switch: stopping the audit and removing the app are the two
          ways out, and someone looking for either looks here. */}
      <RemovePanel
        accountId={props.status.account}
        exportedThisSession={props.exportedThisSession === true}
        auditRunning={checksOn}
        refreshStatus={props.refreshStatus}
      />
    </>
  );
}
