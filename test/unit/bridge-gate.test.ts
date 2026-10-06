import assert from "node:assert/strict";
import { test } from "node:test";
import { gateBridgeMessage, nonceScript } from "../../src/bridge-gate.ts";

const NONCE = "a".repeat(48);
const APP = "https://app.example";
const request = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ source: "minigo-inpage", id: 1, method: "getAddress", params: { prompt: false }, ...extra });

test("accepts a main-frame request that carries the nonce, and strips the nonce", () => {
  const verdict = gateBridgeMessage(request({ nonce: NONCE }), APP, { nonce: NONCE, appOrigin: APP });
  assert.equal(verdict.ok, true);
  if (verdict.ok) assert.deepEqual(JSON.parse(verdict.raw), JSON.parse(request()));
});

test("rejects a request without the nonce (what an iframe can send)", () => {
  assert.deepEqual(gateBridgeMessage(request(), APP, { nonce: NONCE, appOrigin: APP }), { ok: false, reason: "bad-nonce" });
});

test("rejects a guessed, truncated, wrong-typed or empty nonce", () => {
  for (const nonce of ["b".repeat(48), NONCE.slice(1), NONCE + "x", "", 0, null, [NONCE], { n: NONCE }]) {
    const verdict = gateBridgeMessage(request({ nonce }), APP, { nonce: NONCE, appOrigin: APP });
    assert.equal(verdict.ok, false, JSON.stringify(nonce));
  }
});

test("an empty configured nonce never matches anything", () => {
  assert.equal(gateBridgeMessage(request({ nonce: "" }), null, { nonce: "" }).ok, false);
  assert.equal(gateBridgeMessage(request(), null, { nonce: "" }).ok, false);
});

test("the sender origin is still enforced for URL apps, even with a valid nonce", () => {
  assert.deepEqual(gateBridgeMessage(request({ nonce: NONCE }), "https://evil.example", { nonce: NONCE, appOrigin: APP }), {
    ok: false,
    reason: "wrong-origin",
  });
  assert.deepEqual(gateBridgeMessage(request({ nonce: NONCE }), null, { nonce: NONCE, appOrigin: APP }), { ok: false, reason: "wrong-origin" });
});

test("bundled apps have no origin to compare; the nonce alone decides", () => {
  assert.equal(gateBridgeMessage(request({ nonce: NONCE }), "about:blank", { nonce: NONCE }).ok, true);
});

test("ignores things that are not provider requests", () => {
  assert.deepEqual(gateBridgeMessage("not json", APP, { nonce: NONCE }), { ok: false, reason: "not-json" });
  assert.deepEqual(gateBridgeMessage(JSON.stringify({ hello: 1, nonce: NONCE }), APP, { nonce: NONCE }), { ok: false, reason: "not-a-request" });
  assert.deepEqual(gateBridgeMessage("null", APP, { nonce: NONCE }), { ok: false, reason: "not-a-request" });
});

test("the nonce script is inert for any value", () => {
  assert.equal(nonceScript('x";alert(1);"'), 'globalThis.__minigoNonce="x\\";alert(1);\\"";');
});

test("web preview: only the app's own window is accepted, not a frame nested inside it", async () => {
  const { acceptWebFrameMessage } = await import("../../src/bridge-gate.ts");
  const appWindow = {};
  const nested = {};
  assert.equal(acceptWebFrameMessage({ source: appWindow, origin: APP }, appWindow, APP), true);
  assert.equal(acceptWebFrameMessage({ source: nested, origin: APP }, appWindow, APP), false);
  assert.equal(acceptWebFrameMessage({ source: nested, origin: "https://evil.example" }, appWindow, APP), false);
  assert.equal(acceptWebFrameMessage({ source: appWindow, origin: "https://evil.example" }, appWindow, APP), false);
  assert.equal(acceptWebFrameMessage({ source: appWindow, origin: "null" }, appWindow), true); // bundled, sandboxed
  assert.equal(acceptWebFrameMessage({ source: appWindow, origin: APP }, null, APP), false);
});
