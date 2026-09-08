import { describe, expect, it } from "vitest";
import { documentSafe, hasIdentifyingData } from "./documentSafe";

// The real message from a live account on 2026-09-08, with the identifying parts replaced by
// AWS's documented example values — the repo's own rule applies to its tests too.
const REAL =
  "User: arn:aws:sts::111122223333:assumed-role/AgentsPoppyBroker/agentspoppy-b1df195f-a2a9-49d4 " +
  "is not authorized to perform: iam:ListMFADevices on resource: user SomeUser with an explicit " +
  "deny in an identity-based policy. Go to " +
  "https://us-east-1.console.aws.amazon.com/iam/home?region=us-east-1#/authorization-details/5arhuwacg4o48yxyin4kcrony " +
  "for complete details, or call the GetRequestAuthorizationDetails API with the following " +
  "authorization id: 5arhuwacg4o48yxyin4kcrony";

describe("nothing identifying reaches a document", () => {
  it("removes every part of the message that would have gone to an auditor", () => {
    const safe = documentSafe(REAL);
    expect(safe).not.toContain("111122223333");
    expect(safe).not.toContain("arn:aws");
    expect(safe).not.toContain("AgentsPoppyBroker");
    expect(safe).not.toContain("console.aws.amazon.com");
    expect(safe).not.toContain("5arhuwacg4o48yxyin4kcrony");
    expect(hasIdentifyingData(safe)).toBe(false);
  });

  it("keeps the part that is actually useful", () => {
    // The reader should still learn WHAT was refused. Only the identifiers go.
    expect(documentSafe(REAL)).toContain("iam:ListMFADevices");
    expect(documentSafe(REAL)).toContain("explicit deny");
  });

  it("catches the authorization id even when the link wrapped and broke apart", () => {
    // How this gap was found: joining the message across lines split the URL, and stripping
    // whole URLs left "#/authorization-details/<id>" behind as a bare token. Real error text
    // wraps in exactly that way.
    const wrapped = "Go to https://console.aws.amazon.com/iam/home #/authorization-details/5arhuwacg4o48yxyin4kcrony for details";
    expect(documentSafe(wrapped)).not.toContain("5arhuwacg4o48yxyin4kcrony");
  });

  it("catches an account id glued to the next word — the lookaround lesson", () => {
    expect(documentSafe("id 111122223333x and 111122223333")).not.toContain("111122223333");
  });

  it("leaves ordinary prose alone", () => {
    const plain = "Multi-factor authentication could only be checked for 10 of 11 accounts.";
    expect(documentSafe(plain)).toBe(plain);
    expect(hasIdentifyingData(plain)).toBe(false);
  });

  it("does not mistake a 13-digit number for an account id", () => {
    expect(documentSafe("reference 1111222233334")).toContain("1111222233334");
  });

  it("is a backstop, not a guarantee — a bare user name looks like any other word", () => {
    // Stated as a test so nobody mistakes this for a reason to pass raw provider errors into
    // documents. The real defence is classifying the failure and writing a plain sentence.
    expect(documentSafe("user PaymentsAdmin is not authorized")).toContain("PaymentsAdmin");
  });
});
