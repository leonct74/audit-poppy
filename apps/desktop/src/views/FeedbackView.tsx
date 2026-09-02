/**
 * The mandatory Feedback tab (AGENTS.md §9a) — the LAST tab, rendered by the
 * platform's own element so every poppy offers the same four things in the
 * same place. Vendored verbatim from the SDK (see src/vendor; refresh with
 * `node <agentspoppy>/scripts/sync-feedback-tab.mjs --dest src/vendor`).
 */
import { useEffect, useRef } from "react";
import { host } from "../lib/host";
import { defineFeedbackTab } from "../vendor/agentspoppy-feedback-tab";

const POPPY_ID = "com.auditpoppy.desktop";
const BUGS_URL = "https://github.com/leonct74/audit-poppy/issues";

defineFeedbackTab({ openExternal: (url: string) => host.openExternal(url) });

export function FeedbackView() {
  const slot = useRef<HTMLDivElement>(null);

  // Created imperatively so React never reconciles the element's shadow DOM.
  useEffect(() => {
    const mount = slot.current;
    if (!mount || mount.firstChild) return;
    const el = document.createElement("agentspoppy-feedback");
    el.setAttribute("poppy", POPPY_ID);
    el.setAttribute("bugs", BUGS_URL);
    el.setAttribute("name", "AuditPoppy");
    mount.appendChild(el);
  }, []);

  return (
    <div>
      <div className="card">
        <h2>Feedback</h2>
        <p className="small muted2" style={{ margin: 0 }}>
          Tell us how AuditPoppy is doing. Your rating shows on the AgentsPoppy catalogue; everything here is
          anonymous unless you choose to leave your email.
        </p>
      </div>
      <div ref={slot} />
    </div>
  );
}
