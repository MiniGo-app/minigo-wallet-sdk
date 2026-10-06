import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, Networks } from "@stellar/stellar-base";
import { TESTNET } from "../../src/core/network.ts";
import { verifyMessage } from "../../src/core/signing.ts";
import { TOO_MANY_PENDING } from "../../src/core/errors.ts";
import { MAX_MESSAGE_BYTES, MAX_PENDING_APPROVALS, MAX_REQUEST_LENGTH, MAX_XDR_LENGTH, handleRequest, type ApprovalRequest, type HostContext } from "../../src/host.ts";

// The host with a fake wallet: records every approval it is asked for and answers with `decision`.
function fakeHost(decision = true, allowed = true) {
  const keypair = Keypair.random();
  const asked: ApprovalRequest["kind"][] = [];
  let isAllowed = allowed;
  const ctx: HostContext = {
    network: TESTNET,
    address: async () => keypair.publicKey(),
    keypair: async () => keypair,
    isAllowed: async () => isAllowed,
    allow: async () => {
      isAllowed = true;
    },
    approve: async (request) => {
      asked.push(request.kind);
      return decision;
    },
  };
  let id = 0;
  const call = (method: string, params?: unknown) =>
    handleRequest(ctx, "https://app.example", { source: "minigo-inpage", id: ++id, method, params });
  return { keypair, asked, call };
}

test("signMessage: approved requests are signed (SEP-53)", async () => {
  const { keypair, asked, call } = fakeHost();
  const response = await call("signMessage", { message: "hi" });
  const result = response?.result as { signedMessage: string; signerAddress: string };
  assert.deepEqual(asked, ["signMessage"]);
  assert.equal(result.signerAddress, keypair.publicKey());
  assert.ok(verifyMessage(keypair.publicKey(), "hi", result.signedMessage));
});

test("wrong network or signer: refused with -3 before the user is asked", async () => {
  const { asked, call } = fakeHost();
  const wrongNetwork = await call("signMessage", { message: "hi", opts: { networkPassphrase: Networks.PUBLIC } });
  assert.equal(wrongNetwork?.error?.code, -3);
  const wrongSigner = await call("signMessage", { message: "hi", opts: { address: Keypair.random().publicKey() } });
  assert.equal(wrongSigner?.error?.code, -3);
  const badEntry = await call("signAuthEntry", { authEntry: "not xdr" });
  assert.equal(badEntry?.error?.code, -3);
  assert.deepEqual(asked, []);
});

test("declined: -4, and nothing is signed", async () => {
  const { asked, call } = fakeHost(false);
  const response = await call("signMessage", { message: "hi" });
  assert.equal(response?.error?.code, -4);
  assert.equal(response?.result, undefined);
  assert.deepEqual(asked, ["signMessage"]);
});

test("unconnected site: asked to connect first; getAddress without prompt reveals nothing", async () => {
  const { keypair, asked, call } = fakeHost(true, false);
  const quiet = await call("getAddress", { prompt: false });
  assert.deepEqual(quiet?.result, { address: "" });
  assert.deepEqual(asked, []);
  const access = await call("requestAccess");
  assert.deepEqual(access?.result, { address: keypair.publicKey() });
  assert.deepEqual(asked, ["connect"]);
});

test("requestPayment: invalid parameters are refused before touching the network", async () => {
  const { asked, call } = fakeHost();
  for (const params of [
    { to: "GNOTAREALADDRESS", amount: "1" },
    { to: Keypair.random().publicKey(), amount: "0" },
    { to: Keypair.random().publicKey(), amount: "1", asset: "EURC" },
    { to: Keypair.random().publicKey(), amount: "1", memo: "x".repeat(29) },
  ]) {
    const response = await call("requestPayment", params);
    assert.equal(response?.error?.code, -3, JSON.stringify(params));
  }
  assert.deepEqual(asked, []);
});

test("unknown methods and foreign messages", async () => {
  const { call } = fakeHost();
  assert.equal((await call("signEverything"))?.error?.code, -3);
  const ctx = { network: TESTNET } as HostContext;
  assert.equal(await handleRequest(ctx, "x", { source: "someone-else", id: 1, method: "getAddress" }), null);
  assert.equal(await handleRequest(ctx, "x", "not json"), null);
});

test(`a site can have at most ${MAX_PENDING_APPROVALS} prompts waiting; more are refused without asking`, async () => {
  const keypair = Keypair.random();
  const waiting: ((ok: boolean) => void)[] = [];
  const ctx: HostContext = {
    network: TESTNET,
    address: async () => keypair.publicKey(),
    keypair: async () => keypair,
    isAllowed: async () => true,
    allow: async () => {},
    approve: () => new Promise<boolean>((resolve) => waiting.push(resolve)),
  };
  let id = 0;
  const call = (origin: string) => handleRequest(ctx, origin, { source: "minigo-inpage", id: ++id, method: "signMessage", params: { message: "hi" } });

  const first = Array.from({ length: MAX_PENDING_APPROVALS }, () => call("https://spam.example"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waiting.length, MAX_PENDING_APPROVALS);
  const refused = await call("https://spam.example");
  assert.equal(refused?.error?.ext?.[0], TOO_MANY_PENDING);
  assert.equal(waiting.length, MAX_PENDING_APPROVALS, "the user was not asked again");

  // Another site is unaffected.
  const other = call("https://other.example");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waiting.length, MAX_PENDING_APPROVALS + 1);

  // Once the user answers, the site may ask again.
  waiting.splice(0).forEach((resolve) => resolve(false));
  await Promise.all([...first, other]);
  const again = call("https://spam.example");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waiting.length, 1);
  waiting[0](false);
  assert.equal((await again)?.error?.code, -4);
});

test("oversized payloads are refused before the user is asked", async () => {
  const { asked, call } = fakeHost();
  const hugeMessage = await call("signMessage", { message: "x".repeat(MAX_MESSAGE_BYTES + 1) });
  assert.equal(hugeMessage?.error?.code, -3);
  const hugeXdr = await call("signTransaction", { xdr: "A".repeat(MAX_XDR_LENGTH + 1) });
  assert.equal(hugeXdr?.error?.code, -3);
  const hugeEntry = await call("signAuthEntry", { authEntry: "A".repeat(MAX_XDR_LENGTH + 1) });
  assert.equal(hugeEntry?.error?.code, -3);
  assert.deepEqual(asked, []);
  const ctx = { network: TESTNET } as HostContext;
  assert.equal(await handleRequest(ctx, "https://app.example", "x".repeat(MAX_REQUEST_LENGTH + 1)), null);
});
