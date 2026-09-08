/**
 * Strip identifying detail out of any string that is about to enter a DOCUMENT.
 *
 * WHY THIS EXISTS (2026-09-08). The policy pack learned to explain why a fact was missing, and
 * the explanation was built from the cloud provider's own error message. On a live account that
 * message read:
 *
 *   "User: arn:aws:sts::<account>:assumed-role/AgentsPoppyBroker/agentspoppy-<uuid> is not
 *    authorized to perform: iam:ListMFADevices on resource: user <name> with an explicit deny…
 *    Go to https://…console.aws.amazon.com/iam/home#/authorization-details/<id> for details"
 *
 * — an account id, a role name, a session id, a user name and a console URL, rendered into the
 * body of a policy the customer hands to an auditor. The repo has a rule about identifying data
 * in its own files and a test that enforces it; the same care had never been applied to the
 * documents the product PRODUCES, which is the more consequential direction.
 *
 * The primary defence is not this function: it is that a raw provider error should never be put
 * in a document at all — classify the failure and write a plain sentence. This is the backstop
 * for the next person who forgets, because "forgetting" here means a customer emails an ARN to
 * their auditor.
 *
 * It is NOT a guarantee. It removes what has a recognisable shape — ARNs, account ids, URLs —
 * and cannot remove what does not: a bare IAM user name in the middle of a sentence looks like
 * any other word. Classify the failure; do not lean on this.
 */

/** Anything that identifies an account, a principal, or a place to go looking for one. */
const PATTERNS: { re: RegExp; with: string }[] = [
  // ARNs first — they contain account ids, so removing them whole beats redacting inside them.
  { re: /\barn:[a-z0-9-]*:[^\s"']*/gi, with: "[resource]" },
  { re: /\bhttps?:\/\/\S+/gi, with: "[link]" },
  // The console's authorization-details path, matched on its own as well as inside a URL: real
  // error text wraps, and a link broken across a line leaves the id behind as a bare token. The
  // first version of this only stripped whole URLs and left exactly that id in the string.
  { re: /\S*authorization-details\/\S+/gi, with: "[reference redacted]" },
  // A bare 12-digit account id, digits-only lookarounds — the same lesson as naming.test.ts,
  // where excluding letters walked straight past an id glued to the next word.
  { re: /(?<!\d)\d{12}(?!\d)/g, with: "[account]" },
  // AWS's "authorization id" from an explicit-deny message: a support-desk lookup key. The
  // replacement drops the label as well as the value — keeping it would leave text that this
  // module's own detector still matches, so a sanitised string would never test as clean.
  { re: /\bauthorization id:\s*\S+/gi, with: "[reference redacted]" },
];

/**
 * Make `text` safe to print in a customer-facing document.
 *
 * Deliberately blunt: it removes rather than masks, because a partially redacted ARN is still an
 * account id. Returns a trimmed, single-spaced string.
 */
export function documentSafe(text: string): string {
  let out = text;
  for (const p of PATTERNS) out = out.replace(p.re, p.with);
  return out.replace(/\s+/g, " ").trim();
}

/** True when `text` still carries something that must not reach a document. */
export function hasIdentifyingData(text: string): boolean {
  return PATTERNS.some((p) => new RegExp(p.re.source, p.re.flags.replace("g", "")).test(text));
}
