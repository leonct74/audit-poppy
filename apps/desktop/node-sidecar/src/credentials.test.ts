import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInvalidToken, isThrottled } from "./awsErrors";
import { withTokenRecovery } from "./clients";
import type { RefreshableCredentialProvider } from "./credentials";

/** The shape the SDK throws: a named error, not a message we parse. */
const awsError = (name: string, message = name): Error => Object.assign(new Error(message), { name });

describe("recovering from a token AWS has stopped accepting", () => {
  it("recognises a dead token by name, never by message", () => {
    // "The security token included in the request is invalid" — 2026-09-05, live, after the
    // founder re-approved the connection and the session rotated under a running sidecar.
    assert.equal(isInvalidToken(awsError("InvalidClientTokenId", "The security token included in the request is invalid.")), true);
    assert.equal(isInvalidToken(awsError("ExpiredTokenException")), true);
    assert.equal(isInvalidToken(awsError("UnrecognizedClientException")), true);
    assert.equal(isInvalidToken(awsError("AccessDenied")), false);
    assert.equal(isInvalidToken(awsError("ThrottlingException")), false);
  });

  it("keeps throttling and dead tokens apart — the right answer differs", () => {
    // Retrying a throttled call with the same token works; retrying a dead token never can.
    const throttled = awsError("ThrottlingException", "Rate exceeded");
    assert.equal(isThrottled(throttled), true);
    assert.equal(isInvalidToken(throttled), false);

    const dead = awsError("InvalidClientTokenId");
    assert.equal(isInvalidToken(dead), true);
    assert.equal(isThrottled(dead), false);
  });

  it("treats an HTTP 429 with no useful name as throttling", () => {
    const err = Object.assign(new Error("slow down"), { name: "Error", $metadata: { httpStatusCode: 429 } });
    assert.equal(isThrottled(err), true);
  });
});

describe("withTokenRecovery", () => {
  const provider = (): { p: RefreshableCredentialProvider; invalidated: () => number } => {
    let n = 0;
    const fn = (async () => ({ accessKeyId: "a", secretAccessKey: "b" })) as RefreshableCredentialProvider;
    fn.invalidate = () => {
      n += 1;
    };
    return { p: fn, invalidated: () => n };
  };

  it("re-mints and retries once when the token is dead, and the call then succeeds", async () => {
    const { p, invalidated } = provider();
    let built = 0;
    let calls = 0;
    const api = withTokenRecovery(() => {
      built += 1;
      return {
        send: async () => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error("bad token"), { name: "InvalidClientTokenId" });
          return "ok";
        },
      };
    }, p);

    assert.equal(await api.send({}), "ok");
    assert.equal(invalidated(), 1, "our credential cache must be dropped");
    assert.equal(built, 2, "the client must be REBUILT — the SDK memoizes the identity it was given");
    assert.equal(calls, 2);
  });

  it("gives up after one retry — a second dead token is a real failure, not a loop", async () => {
    const { p } = provider();
    let calls = 0;
    const api = withTokenRecovery(() => ({
      send: async () => {
        calls += 1;
        throw Object.assign(new Error("bad token"), { name: "InvalidClientTokenId" });
      },
    }), p);

    await assert.rejects(() => api.send({}), /bad token/);
    assert.equal(calls, 2, "exactly one retry");
  });

  it("never retries anything else — an AccessDenied retried is just twice the damage", async () => {
    const { p, invalidated } = provider();
    let calls = 0;
    const api = withTokenRecovery(() => ({
      send: async () => {
        calls += 1;
        throw Object.assign(new Error("nope"), { name: "AccessDenied" });
      },
    }), p);

    await assert.rejects(() => api.send({}), /nope/);
    assert.equal(calls, 1);
    assert.equal(invalidated(), 0);
  });

  it("passes straight through in developer mode, where there is no broker to re-mint from", async () => {
    let calls = 0;
    const api = withTokenRecovery(() => ({
      send: async () => {
        calls += 1;
        throw Object.assign(new Error("bad token"), { name: "InvalidClientTokenId" });
      },
    }), undefined);
    await assert.rejects(() => api.send({}), /bad token/);
    assert.equal(calls, 1);
  });
});
