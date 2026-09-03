/**
 * Shared UI atoms on the design kit. PendingButton is the load-bearing one:
 * every async control MUST react the instant it's pressed and always resolve
 * (AGENTS.md §9 "Every button must respond") — it disables itself, shows a
 * spinner + busy label, and restores in `finally`, so no thrown error can
 * leave a button stuck.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";

export function PendingButton(props: {
  onClick: () => Promise<void>;
  busyLabel: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const click = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await props.onClick();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, props]);
  return (
    <button
      type="button"
      className={props.className ?? "btn"}
      disabled={busy || props.disabled}
      onClick={() => void click()}
      title={props.title}
    >
      {busy ? (
        <>
          <span className="spinner" /> {props.busyLabel}
        </>
      ) : (
        props.children
      )}
    </button>
  );
}

export function Banner(props: { kind: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  return <div className={`banner ${props.kind}`}>{props.children}</div>;
}

export function Chip(props: { kind?: "ok" | "warn" | "danger" | "accent"; children: ReactNode }) {
  return <span className={`chip ${props.kind ?? ""}`}>{props.children}</span>;
}

/**
 * Type-to-confirm for destructive actions (AGENTS.md §4): names the blast
 * radius, focuses Cancel, and only arms the destroy button once the user has
 * typed the expected word.
 */
export function TypeToConfirm(props: {
  word: string;
  blastRadius: ReactNode;
  actionLabel: string;
  busyLabel: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const armed = typed.trim() === props.word;
  return (
    <div className="card" style={{ borderColor: "var(--poppy-danger)" }}>
      <h2>Are you sure?</h2>
      <div className="small" style={{ marginBottom: 8 }}>{props.blastRadius}</div>
      <div className="field">
        <label>
          Type <span className="mono">{props.word}</span> to confirm — this can't be undone.
        </label>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={props.word} />
      </div>
      <div className="row">
        <button type="button" className="btn" autoFocus onClick={props.onCancel}>
          Cancel
        </button>
        <PendingButton className="btn btn-danger" disabled={!armed} busyLabel={props.busyLabel} onClick={props.onConfirm}>
          {props.actionLabel}
        </PendingButton>
      </div>
    </div>
  );
}

/** One calm sentence for any failure (plain-language rule). */
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/paused|expired|connection/i.test(msg)) {
    return "Couldn't reach your cloud account through AgentsPoppy — check AuditPoppy's connection is active in AgentsPoppy, then try again.";
  }
  return msg;
}
