/**
 * Copy text to the clipboard, robust to contexts where the async Clipboard API is blocked —
 * inside a host webview that doesn't delegate `clipboard-write`, or a non-secure origin. Falls
 * back to the legacy execCommand path, which needs only the user gesture that already happened
 * (the click) and no Permissions-Policy grant.
 *
 * AuditPoppy runs as an AgentsPoppy extension inside the host's webview, so EVERY copy
 * affordance needs this: a copy button that silently fails is a dead button (AGENTS.md §9).
 * The original helper banner called navigator.clipboard directly and swallowed the rejection —
 * the label never changed and the user was told nothing.
 *
 * Pattern copied from MailPoppy, which hit this first.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
