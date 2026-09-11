import { describe, expect, it } from "vitest";
import { confirmMatches } from "./confirm";

describe("the type-to-confirm phrase", () => {
  it("accepts the phrase the user was actually shown", () => {
    expect(confirmMatches("stop auditing", "stop auditing")).toBe(true);
    expect(confirmMatches("remove", "remove")).toBe(true);
  });

  it("accepts the capital the keyboard added on its own", () => {
    // The bug, exactly: the field had no autoCapitalize, the webview capitalised the first
    // letter, and the button stayed dead while the user looked at the right words on screen.
    expect(confirmMatches("Stop auditing", "stop auditing")).toBe(true);
    expect(confirmMatches("Remove", "remove")).toBe(true);
    expect(confirmMatches("STOP AUDITING", "stop auditing")).toBe(true);
  });

  it("forgives stray spacing, which autocorrect also supplies", () => {
    expect(confirmMatches("  stop auditing  ", "stop auditing")).toBe(true);
    expect(confirmMatches("stop  auditing", "stop auditing")).toBe(true);
  });

  it("still refuses anything that is not the phrase — the ritual has to mean something", () => {
    expect(confirmMatches("stop", "stop auditing")).toBe(false);
    expect(confirmMatches("auditing", "stop auditing")).toBe(false);
    expect(confirmMatches("stop audit", "stop auditing")).toBe(false);
    expect(confirmMatches("yes", "remove")).toBe(false);
    expect(confirmMatches("removed", "remove")).toBe(false);
  });

  it("never arms on an empty field", () => {
    expect(confirmMatches("", "remove")).toBe(false);
    expect(confirmMatches("   ", "remove")).toBe(false);
  });
});
