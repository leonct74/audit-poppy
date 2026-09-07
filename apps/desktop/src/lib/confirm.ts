/**
 * Does what the user typed match the confirmation phrase?
 *
 * Deliberately forgiving about case and spacing, because the strict version was a trap. The
 * field had no `autoCapitalize` attribute, so the host's webview helpfully capitalised the first
 * letter: the user typed exactly the phrase on screen, the field held "Stop auditing", the
 * comparison failed, and the button stayed dead with nothing to explain why. The founder hit it
 * on 2026-09-07 and reasonably concluded the button was broken.
 *
 * What the ritual is FOR is making someone stop and consider — deliberate intent, not
 * dictation. A capital letter their keyboard chose for them is not a sign of doubt, so it must
 * not be a barrier. Typing something else entirely still fails, which is the whole point.
 */
export function confirmMatches(typed: string, phrase: string): boolean {
  const normalize = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
  const t = normalize(typed);
  return t.length > 0 && t === normalize(phrase);
}
