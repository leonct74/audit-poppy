/**
 * Remove AuditPoppy from this cloud account — the flow DESIGN §3 specified and nothing built.
 *
 * The sidecar has had /teardown since day one because the host calls it on uninstall, but no
 * screen ever called it: a user could stop the audit, yet had no way to remove the bucket, the
 * stack and the table without uninstalling the whole extension. The founder went looking for the
 * button on 2026-09-07 and there wasn't one.
 *
 * The design's two safeguards, both load-bearing:
 *   • EXPORT FIRST. Evidence is the one thing a user may want to outlive the poppy, and deleting
 *     a year of it is not undoable. So removal will not arm until the package has been built, or
 *     the user says outright they do not want it.
 *   • TYPE-TO-CONFIRM, naming the account, so nobody removes from the wrong one.
 *
 * What it never touches: anything the ledger marked "found enabled, not ours".
 */
import { useState } from "react";
import { api, type TeardownResponse } from "../lib/api";
import { Banner, friendlyError, PendingButton, TypeToConfirm } from "../ui";

export function RemovePanel(props: { accountId: string | null; exportedThisSession: boolean; refreshStatus: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [acceptedNoExport, setAcceptedNoExport] = useState(false);
  const [report, setReport] = useState<TeardownResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const evidenceSafe = props.exportedThisSession || acceptedNoExport;

  if (report) {
    return (
      <div className="card">
        <h2>Removed</h2>
        <Banner kind={report.problems.length > 0 ? "warn" : "ok"}>
          <div>
            {report.disabled.length > 0
              ? `Turned off: ${report.disabled.join(", ")}.`
              : "Nothing was ours to turn off."}{" "}
            {report.stackDeleted ? "The stack is deleted." : "The stack was already gone."}{" "}
            {report.bucketEmptied ? "The evidence bucket is emptied and deleted." : ""}
            {report.leftAlone.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                Left alone, because it was already on before AuditPoppy:{" "}
                <strong>{report.leftAlone.join(", ")}</strong>.
              </div>
            ) : null}
            {report.problems.length > 0 ? (
              <div style={{ marginTop: 6 }}>Some steps reported a problem: {report.problems.join("; ")}</div>
            ) : null}
          </div>
        </Banner>
      </div>
    );
  }

  return (
    <div className="card" style={{ borderColor: "var(--poppy-danger)" }}>
      <h2>Remove AuditPoppy from this cloud account</h2>
      <p className="small muted2" style={{ marginTop: 0 }}>
        Turns off what AuditPoppy turned on, deletes its stack, and empties and deletes its evidence bucket.
        Anything that was already on before AuditPoppy is left exactly as it was.
      </p>

      {/* Export first. A year of evidence is the one thing here that cannot be rebuilt. */}
      {!evidenceSafe ? (
        <Banner kind="warn">
          <div>
            <strong>Take your evidence first.</strong> Removal deletes the bucket and every bundle in it, and
            an auditor may ask for that history after you have stopped using the app. Build the package on the
            Export tab, then come back.
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAcceptedNoExport(true)}>
                I don't need the evidence — continue anyway
              </button>
            </div>
          </div>
        </Banner>
      ) : null}

      {error ? <Banner kind="danger">{error}</Banner> : null}

      {confirming ? (
        <TypeToConfirm
          word="remove"
          blastRadius={
            <>
              This removes AuditPoppy's footprint from cloud account{" "}
              <span className="mono">{props.accountId ?? "—"}</span>: the Security Hub checks and Config change
              record it turned on, its CloudFormation stack, and its evidence bucket{" "}
              <strong>including every bundle in it</strong>. Anything found already enabled is{" "}
              <strong>not</strong> touched. The gap report and the export you already downloaded are yours to keep.
            </>
          }
          actionLabel="Remove AuditPoppy"
          busyLabel="Removing…"
          onConfirm={async () => {
            setError(null);
            try {
              setReport(await api.teardown());
              setConfirming(false);
              props.refreshStatus();
            } catch (err) {
              setError(friendlyError(err));
            }
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <PendingButton
          className="btn btn-danger"
          busyLabel="…"
          disabled={!evidenceSafe}
          onClick={async () => setConfirming(true)}
        >
          Remove AuditPoppy
        </PendingButton>
      )}
    </div>
  );
}
