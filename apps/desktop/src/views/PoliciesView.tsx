/**
 * Policies — the policy pack (DESIGN §2.3): the written policies auditors
 * require, pre-filled from the REAL observed posture. The two registers stay
 * visibly distinct: observed facts render as read-only chips; the company's
 * own answers are editable fields. Guidance, not legal advice — said on every
 * document.
 */
import { useEffect, useState } from "react";
import type { RenderedPolicy } from "@auditpoppy/core";
import { api, type PoliciesResponse } from "../lib/api";
import { Banner, Chip, friendlyError, PendingButton } from "../ui";
import { HelperBanner } from "./HelperBanner";

function PolicyCard(props: {
  policy: RenderedPolicy;
  savedAnswers: Record<string, string>;
  onSaved: () => void;
}) {
  const { policy } = props;
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>(props.savedAnswers);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const editable = policy.fields.filter((f) => f.register === "customer-entered");
  const observed = policy.fields.filter((f) => f.register === "platform-observed");

  return (
    <div className="card">
      <div className="spread">
        <h2 style={{ margin: 0 }}>{policy.title}</h2>
        <div className="row">
          {policy.tsc.map((t) => (
            <Chip key={t} kind="accent">
              {t}
            </Chip>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
            {open ? "Close" : "Edit & preview"}
          </button>
        </div>
      </div>
      <div className="small muted">{policy.disclaimer}</div>
      {open ? (
        <>
          <h3>Observed in your cloud account</h3>
          <div className="row">
            {observed.map((f) => (
              <span key={f.id} className="chip" title="Read from your account — updates on each scan">
                {f.label}: <strong>{f.value}</strong>
              </span>
            ))}
          </div>
          <h3>Your answers</h3>
          {editable.map((f) => (
            <div className="field" key={f.id}>
              <label>{f.label}</label>
              <input
                value={answers[f.id] ?? ""}
                placeholder={f.suggestion ?? ""}
                onChange={(e) => {
                  setSaved(false);
                  setAnswers({ ...answers, [f.id]: e.target.value });
                }}
              />
            </div>
          ))}
          {error ? <Banner kind="danger">{error}</Banner> : null}
          <div className="row">
            <PendingButton
              className="btn btn-primary btn-sm"
              busyLabel="Saving…"
              onClick={async () => {
                setError(null);
                try {
                  await api.saveAnswers(policy.id, answers);
                  setSaved(true);
                  props.onSaved();
                } catch (err) {
                  setError(friendlyError(err));
                }
              }}
            >
              Save answers
            </PendingButton>
            {saved ? <span className="small" style={{ color: "var(--poppy-ok)" }}>Saved ✓</span> : null}
          </div>
          <h3>Preview</h3>
          {policy.sections.map((s) => (
            <div key={s.heading} style={{ marginBottom: 8 }}>
              <strong className="small">{s.heading}</strong>
              <div className="small muted2">{s.body}</div>
            </div>
          ))}
          <div className="small muted">
            The preview uses your saved answers; unsaved edits appear after you save. Exported documents show
            observed facts and your statements in visibly different type.
          </div>
        </>
      ) : null}
    </div>
  );
}

export function PoliciesView() {
  const [data, setData] = useState<PoliciesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    api
      .policies()
      .then(setData)
      .catch((err: unknown) => setError(friendlyError(err)));
  };
  useEffect(load, []);

  if (error) return <Banner kind="danger">{error}</Banner>;
  if (!data)
    return (
      <div className="card row">
        <span className="spinner" /> Reading your account's posture to pre-fill the policies…
      </div>
    );

  return (
    <>
      <HelperBanner where="policies" />
      <p className="small muted2">
        The written policies auditors ask for, pre-filled from what AuditPoppy can actually observe in your
        account. Answer the company-specific fields once; the Export tab packages the finished documents.
      </p>
      {data.rendered.map((policy) => (
        <PolicyCard
          key={policy.id}
          policy={policy}
          savedAnswers={data.answers[policy.id] ?? {}}
          onSaved={load}
        />
      ))}
    </>
  );
}
