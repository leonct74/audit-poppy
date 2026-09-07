/**
 * "Copy the helper prompt" — AGENTS.md §9, required on the primary configuration surface.
 *
 * It lives on THREE screens, not one. The prompt answers with what to enable, every policy
 * field, AND the notes for the auditor — but it used to appear only on the pre-audit panel, so
 * it vanished at exactly the moment two thirds of its output became relevant. Someone who has
 * already started the audit and is staring at a blank policy form is the person who needs it
 * most, and they could no longer reach it.
 */
import { useState } from "react";
import { buildHelperPrompt } from "../lib/helperPrompt";
import { copyText } from "../lib/clipboard";
import { Banner } from "../ui";

export function HelperBanner(props: { where: "audit" | "policies" | "notes" }) {
  const [copied, setCopied] = useState(false);
  const [used, setUsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lead = {
    audit: "Not sure what to turn on, or what it will cost you?",
    policies: "Staring at an empty policy form?",
    notes: "Not sure what your auditor needs to be told?",
  }[props.where];

  return (
    <Banner kind="info">
      <div style={{ flex: 1 }}>
        <div style={{ marginBottom: 6 }}>
          <strong>{lead}</strong> Copy the helper prompt, paste it into the AI you already use, and add one
          sentence about your company — it answers with exactly what to tick and type here.
        </div>
        <button
          type="button"
          className={`btn btn-primary btn-sm${used ? "" : " poppy-helper-pulse"}`}
          onClick={() => {
            setError(null);
            setUsed(true);
            void copyText(buildHelperPrompt()).then((ok) => {
              if (!ok) {
                setError("Couldn't reach the clipboard. Select the prompt below and copy it by hand.");
                return;
              }
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2500);
            });
          }}
        >
          {copied ? "Copied ✓" : "Copy the helper prompt"}
        </button>
        {error ? (
          <>
            <div className="small muted" style={{ marginTop: 6 }}>
              {error}
            </div>
            <textarea readOnly rows={6} value={buildHelperPrompt()} style={{ marginTop: 6, width: "100%" }} />
          </>
        ) : null}
      </div>
    </Banner>
  );
}
