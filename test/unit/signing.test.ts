import assert from "node:assert/strict";
import { test } from "node:test";
import { Account, Asset, hash, Keypair, Networks, Operation, TransactionBuilder, xdr, Address, nativeToScVal } from "@stellar/stellar-base";
import { fromBase64, toBase64 } from "../../src/core/bytes.ts";
import { signAuthEntryXdr, signMessageText, signTransactionXdr, verifyMessage } from "../../src/core/signing.ts";

const TESTNET = Networks.TESTNET;

// SEP-53 test vectors (stellar-protocol/ecosystem/sep-0053.md)
const SEP53_SEED = "SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW";
const SEP53_ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";

test("SEP-53 vector 1: ASCII message", () => {
  const r = signMessageText(Keypair.fromSecret(SEP53_SEED), "Hello, World!", TESTNET);
  assert.ok(r.ok);
  assert.equal(r.value.signerAddress, SEP53_ADDRESS);
  assert.equal(r.value.signedMessage, "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==");
  assert.ok(verifyMessage(SEP53_ADDRESS, "Hello, World!", r.value.signedMessage));
});

test("SEP-53 vector 2: Japanese message", () => {
  const r = signMessageText(Keypair.fromSecret(SEP53_SEED), "こんにちは、世界！", TESTNET);
  assert.ok(r.ok);
  assert.equal(r.value.signedMessage, "CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==");
});

test("SEP-53 vector 3: binary message verifies", () => {
  const message = fromBase64("2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=");
  const signature = "VA1+7hefNwv2NKScH6n+Sljj15kLAge+M2wE7fzFOf+L0MMbssA1mwfJZRyyrhBORQRle10X1Dxpx+UOI4EbDQ==";
  assert.ok(verifyMessage(SEP53_ADDRESS, message, signature));
  assert.ok(!verifyMessage(SEP53_ADDRESS, "tampered", signature));
});

function paymentXdr(source: string) {
  return new TransactionBuilder(new Account(source, "1"), { fee: "100", networkPassphrase: TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
    .setTimeout(60)
    .build()
    .toXDR();
}

test("signTransaction adds a valid signature from our key", () => {
  const kp = Keypair.random();
  const r = signTransactionXdr(kp, paymentXdr(kp.publicKey()), TESTNET, { networkPassphrase: TESTNET, address: kp.publicKey() });
  assert.ok(r.ok);
  const tx = TransactionBuilder.fromXDR(r.value.signedTxXdr, TESTNET);
  assert.equal(tx.signatures.length, 1);
  assert.ok(kp.verify(tx.hash(), tx.signatures[0].signature()));
});

test("signTransaction refuses another network, another signer or bad XDR with code -3", () => {
  const kp = Keypair.random();
  const wrongNet = signTransactionXdr(kp, paymentXdr(kp.publicKey()), TESTNET, { networkPassphrase: Networks.PUBLIC });
  const wrongSigner = signTransactionXdr(kp, paymentXdr(kp.publicKey()), TESTNET, { address: Keypair.random().publicKey() });
  const garbage = signTransactionXdr(kp, "AAAAnotxdr", TESTNET);
  for (const r of [wrongNet, wrongSigner, garbage]) {
    assert.ok(!r.ok);
    assert.equal(r.error.code, -3);
  }
});

function authPreimage(networkPassphrase: string) {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC").toScAddress(),
        functionName: "transfer",
        args: [nativeToScVal(1n, { type: "i128" })],
      }),
    ),
    subInvocations: [],
  });
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase)),
      nonce: xdr.Int64.fromString("42"),
      signatureExpirationLedger: 1000,
      invocation,
    }),
  );
}

test("signAuthEntry signs the SHA-256 of the preimage", () => {
  const kp = Keypair.random();
  const preimage = authPreimage(TESTNET);
  const r = signAuthEntryXdr(kp, preimage.toXDR("base64"), TESTNET);
  assert.ok(r.ok);
  assert.ok(kp.verify(hash(preimage.toXDR()), Buffer.from(fromBase64(r.value.signedAuthEntry))));
});

test("signAuthEntry refuses an entry for another network", () => {
  const r = signAuthEntryXdr(Keypair.random(), authPreimage(Networks.PUBLIC).toXDR("base64"), TESTNET);
  assert.ok(!r.ok);
  assert.equal(r.error.code, -3);
});

test("base64 helpers round-trip", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 7]);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  assert.equal(toBase64(new TextEncoder().encode("hi!")), Buffer.from("hi!").toString("base64"));
});
