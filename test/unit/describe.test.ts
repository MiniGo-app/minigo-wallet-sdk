import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Account, Address, Asset, Keypair, Networks, Operation, TransactionBuilder, hash, nativeToScVal, xdr } from "@stellar/stellar-base";
import { describeAuthEntry, describeTransaction } from "../../src/core/describe.ts";
import { FALLBACK_BASE_RESERVE, loadBaseReserve } from "../../src/core/horizon.ts";
import { TESTNET } from "../../src/core/network.ts";

const wallet = Keypair.random().publicKey();
const builder = Keypair.random().publicKey();
const dest = Keypair.random().publicKey();

const txWith = (source: string, opSource?: string) =>
  new TransactionBuilder(new Account(source, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: dest, asset: Asset.native(), amount: "500", source: opSource }))
    .setTimeout(60)
    .build();

test("an operation drawn on the wallet by someone else's transaction says so", () => {
  const summary = describeTransaction(txWith(builder, wallet), wallet);
  assert.match(summary.operations[0], /\(from your account\)$/);
  assert.equal(summary.sourceIsYou, false);
  assert.equal(summary.usesYourAccount, true);
});

test("an operation on another account is labelled with that address; own transactions stay plain", () => {
  const other = describeTransaction(txWith(wallet, builder), wallet);
  assert.match(other.operations[0], /\(from [A-Z0-9]{4}…[A-Z0-9]{4}\)$/);
  const own = describeTransaction(txWith(wallet), wallet);
  assert.doesNotMatch(own.operations[0], /from/);
  assert.equal(own.sourceIsYou, true);
});

test("describeAuthEntry reads the contract, function and arguments", () => {
  const contract = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const nested = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: Address.fromString(contract).toScAddress(), functionName: "inner", args: [] }),
    ),
    subInvocations: [],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(contract).toScAddress(),
        functionName: "transfer",
        args: [nativeToScVal(wallet, { type: "address" }), nativeToScVal(1234n, { type: "i128" })],
      }),
    ),
    subInvocations: [nested],
  });
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(Networks.TESTNET)),
      nonce: xdr.Int64.fromString("1"),
      signatureExpirationLedger: 5000,
      invocation,
    }),
  );
  const details = describeAuthEntry(preimage);
  assert.equal(details.contract, contract);
  assert.equal(details.functionName, "transfer");
  assert.deepEqual(details.args, [wallet, "1234"]);
  assert.equal(details.nestedCalls, 1);
  assert.equal(details.expiresAtLedger, 5000);
});

// Base reserve comes from the ledger, not a constant.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("loadBaseReserve reads the ledger, and falls back only when it can't", async () => {
  const network = { ...TESTNET, networkPassphrase: "reserve test network 1" };
  globalThis.fetch = (async () => Response.json({ _embedded: { records: [{ base_reserve_in_stroops: 1000000 }] } })) as typeof fetch;
  assert.equal(await loadBaseReserve(network), 0.1);
  const unreachable = { ...TESTNET, networkPassphrase: "reserve test network 2" };
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  assert.equal(await loadBaseReserve(unreachable), FALLBACK_BASE_RESERVE);
});

test("transactions expire on the network's clock, not a skewed phone clock", async () => {
  const { buildChangeTrust, networkNowSeconds } = await import("../../src/core/horizon.ts");
  const network = { ...TESTNET, networkPassphrase: "clock test network" };
  const phone = Date.now();
  const networkTime = phone - 60 * 60 * 1000; // the phone runs an hour ahead
  globalThis.fetch = (async (url: string) => {
    const body = String(url).includes("/ledgers")
      ? { _embedded: { records: [{ base_reserve_in_stroops: 5000000 }] } }
      : { sequence: "1", subentry_count: 0, num_sponsoring: 0, num_sponsored: 0, balances: [{ asset_type: "native", balance: "10" }] };
    return new Response(JSON.stringify(body), { headers: { date: new Date(networkTime).toUTCString() } });
  }) as typeof fetch;
  const tx = await buildChangeTrust(network, Keypair.random().publicKey(), new Asset("USDC", Keypair.random().publicKey()));
  const max = Number(tx.timeBounds!.maxTime);
  assert.ok(Math.abs(networkNowSeconds() - Math.floor(networkTime / 1000)) <= 2);
  assert.ok(max > networkNowSeconds() && max <= networkNowSeconds() + 181, `expiry ${max}`);
  assert.equal(tx.timeBounds!.minTime, "0");
});
