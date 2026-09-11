import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLocalRequest } from "./localOnly";

describe("who is allowed to talk to the sidecar", () => {
  it("serves the host's own server-side call, which carries no Origin", () => {
    assert.equal(isLocalRequest({ host: "127.0.0.1:39271" }), true);
    assert.equal(isLocalRequest({ host: "localhost:39271" }), true);
  });

  it("refuses anything a browser sent, because only a browser sets Origin", () => {
    // The attack this kills: a page the user has open POSTs /teardown. No preflight is sent
    // for a simple request, so "no CORS headers on the response" would not have saved us —
    // the side effect lands before the browser ever reads the reply.
    assert.equal(isLocalRequest({ host: "127.0.0.1:39271", origin: "https://evil.example" }), false);
    // Even an Origin that looks like us. A page cannot be trusted about its own identity here,
    // and there is no legitimate caller that sets this header at all.
    assert.equal(isLocalRequest({ host: "127.0.0.1:39271", origin: "http://127.0.0.1:39271" }), false);
    // "null" is what a sandboxed iframe or a file:// page sends.
    assert.equal(isLocalRequest({ host: "127.0.0.1:39271", origin: "null" }), false);
  });

  it("refuses a rebound hostname even with no Origin — DNS rebinding sends neither", () => {
    // attacker.example resolving to 127.0.0.1: the request is same-origin by then, so no
    // Origin is sent, and Host is the only thing left that still tells the truth.
    assert.equal(isLocalRequest({ host: "attacker.example" }), false);
    assert.equal(isLocalRequest({ host: "attacker.example:39271" }), false);
    // A prefix match would have let this through.
    assert.equal(isLocalRequest({ host: "127.0.0.1.evil.example" }), false);
    assert.equal(isLocalRequest({ host: "localhost.evil.example" }), false);
  });

  it("refuses a request with no Host at all rather than defaulting to allow", () => {
    assert.equal(isLocalRequest({}), false);
  });

  it("handles the shapes node actually hands us", () => {
    assert.equal(isLocalRequest({ host: "LOCALHOST:39271" }), true);
    assert.equal(isLocalRequest({ host: "[::1]:39271" }), true);
    // Node gives an array when a header arrives twice. Judge the first, and never let a second
    // copy smuggle a different answer past the first.
    assert.equal(isLocalRequest({ host: ["127.0.0.1:39271", "evil.example"] }), true);
    assert.equal(isLocalRequest({ host: ["evil.example", "127.0.0.1"] }), false);
    assert.equal(isLocalRequest({ host: "127.0.0.1", origin: ["https://evil.example"] }), false);
  });
});
