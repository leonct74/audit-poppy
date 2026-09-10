/**
 * Evidence — continuous collection (DESIGN §2.2): deploy the one small stack
 * (versioned evidence bucket + monthly snapshot Lambda + assessments table),
 * list the dated bundles, capture one on demand. Deploy state is derived from
 * CloudFormation live on every poll — leave and come back, it resumes.
 */
import { useEffect, useState } from "react";
import type { EvidenceBundleSummary } from "@auditpoppy/core";
import { api, type StatusResponse, type StackInfo } from "../lib/api";
import { Banner, Chip, friendlyError, PendingButton } from "../ui";

const STACK_LABEL: Record<StackInfo["status"], string> = {
  ABSENT: "Not set up yet",
  CREATING: "Creating your evidence storage…",
  STORAGE_READY: "Storage ready — finishing the monthly snapshot setup",
  UPDATING: "Finishing the monthly snapshot setup…",
  COMPLETE: "Running — a snapshot lands in your bucket every month",
  DELETING: "Removing…",
  FAILED: "Something went wrong",
};

export function EvidenceView(props: { status: StatusResponse; refreshStatus: () => void }) {
  const [stack, setStack] = useState<StackInfo>(props.status.stack);
  const [bundles, setBundles] = useState<EvidenceBundleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // NOT ROLLBACK_COMPLETE: a rolled-back create is cleared and then STOPS, so the person can read
  // why before pressing again. Polling through it is what made an unbounded create/rollback loop
  // that showed "Creating…" forever.
  const inProgress =
    stack.status === "CREATING" || stack.status === "UPDATING" || stack.status === "STORAGE_READY" ||
    stack.status === "DELETING";
  // A half-finished REMOVAL is not a setup failure, and retrying setup cannot clear it — only
  // finishing the removal can, and that deletes evidence, so it stays behind the removal screen.
  const stuckOnRemoval = stack.rawStatus === "DELETE_FAILED";

  const loadBundles = (): void => {
    api
      .evidence()
      .then((r) => setBundles(r.bundles))
      .catch((err: unknown) => setError(friendlyError(err)));
  };

  useEffect(() => {
    setStack(props.status.stack);
    if (props.status.stack.status === "COMPLETE" || props.status.stack.status === "STORAGE_READY") loadBundles();
  }, [props.status.stack]);

  // Advance/poll the two-phase deploy while it's mid-flight. Each /deploy call
  // issues at most one step and reports the live state — safe to repeat.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => {
      api
        .deploy()
        .then(setStack)
        .catch((err: unknown) => setError(friendlyError(err)));
    }, 5000);
    return () => clearInterval(timer);
  }, [inProgress]);

  return (
    <>
      <div className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Continuous evidence</h2>
          <Chip kind={stack.status === "COMPLETE" ? "ok" : stack.status === "FAILED" ? "danger" : undefined}>
            {STACK_LABEL[stack.status]}
          </Chip>
        </div>
        <p className="small muted2" style={{ marginBottom: 8 }}>
          An auditor needs proof your controls operated <em>over the audit period</em>, not just today. This
          sets up, in your own account: a locked-down, versioned evidence bucket, a small function that writes
          a dated posture bundle into it every month, and a table for scan history. Estimated cost: cents per
          month — it runs once a month.
        </p>
        {stack.evidenceBucket ? (
          <div className="small muted">
            Evidence bucket: <span className="mono">{stack.evidenceBucket}</span>
          </div>
        ) : null}
        {stack.status === "FAILED" && stuckOnRemoval ? (
          <Banner kind="danger">
            <div>
              A previous removal didn&apos;t finish, so the old setup is still there and a new one
              can&apos;t be started over it.
              {stack.statusReason ? ` Your cloud provider said: ${stack.statusReason}` : ""}
            </div>
            <div style={{ marginTop: 6 }}>
              Finish removing it from <strong>Remove AuditPoppy</strong> at the bottom of this tab, then set
              up evidence collection again. It is deliberately not a button here: finishing that removal
              deletes the evidence bucket, and that cannot be undone.
            </div>
          </Banner>
        ) : stack.status === "FAILED" ? (
          <Banner kind="danger">
            The setup didn't finish{stack.statusReason ? `: ${stack.statusReason}` : "."} You can retry — it
            picks up from where AWS actually is.
          </Banner>
        ) : null}
        {error ? <Banner kind="danger">{error}</Banner> : null}
        {stack.status === "ABSENT" || (stack.status === "FAILED" && !stuckOnRemoval) ? (
          <PendingButton
            className="btn btn-primary"
            busyLabel="Starting…"
            onClick={async () => {
              setError(null);
              try {
                setStack(await api.deploy());
              } catch (err) {
                setError(friendlyError(err));
              }
            }}
          >
            Set up evidence collection
          </PendingButton>
        ) : null}
        {inProgress ? (
          <div className="progress-line small muted2">
            <span className="dot busy" /> Working — this continues in the background; you can leave and come
            back.
          </div>
        ) : null}
      </div>

      {stack.status === "COMPLETE" || stack.status === "STORAGE_READY" ? (
        <div className="card">
          <div className="spread">
            <h2 style={{ margin: 0 }}>Evidence bundles</h2>
            <PendingButton
              className="btn btn-sm"
              busyLabel="Capturing…"
              disabled={stack.status !== "COMPLETE" && stack.status !== "STORAGE_READY"}
              onClick={async () => {
                setError(null);
                setNotice(null);
                try {
                  const res = await api.snapshot();
                  setNotice(`Captured ${res.key} into your evidence bucket.`);
                  loadBundles();
                } catch (err) {
                  setError(friendlyError(err));
                }
              }}
            >
              Capture a snapshot now
            </PendingButton>
          </div>
          {notice ? <Banner kind="ok">{notice}</Banner> : null}
          {bundles === null ? (
            <div className="row small muted">
              <span className="spinner" /> Reading your bucket…
            </div>
          ) : bundles.length === 0 ? (
            <p className="small muted2">
              No bundles yet. The monthly snapshot writes the first one on the 1st; or capture one now to see
              the shape your auditor gets.
            </p>
          ) : (
            <ul className="control-list">
              {bundles.map((b) => (
                <li key={b.key} className="row">
                  <span className="mono">{b.capturedAt.slice(0, 10)}</span>
                  <Chip kind="ok">{b.totals.passed} pass</Chip>
                  <Chip kind={b.totals.failed > 0 ? "danger" : undefined}>{b.totals.failed} fail</Chip>
                  <span className="mono muted small">{b.key}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">
            Bundles live only in your own bucket — nothing leaves your cloud. The Export tab indexes them for
            your auditor.
          </p>
        </div>
      ) : null}
    </>
  );
}
