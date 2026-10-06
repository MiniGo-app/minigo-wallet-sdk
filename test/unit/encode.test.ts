import assert from "node:assert/strict";
import { test } from "node:test";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-base";
import { toHex, transactionHashHex, transactionXdr } from "../../src/core/encode.ts";

const tx = () =>
  new TransactionBuilder(new Account(Keypair.random().publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
    .setTimebounds(0, 1900000000)
    .build();

test("transactionXdr is base64 that reads back to the same transaction", () => {
  const t = tx();
  const text = transactionXdr(t);
  assert.match(text, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(text, t.toXDR());
  assert.equal(TransactionBuilder.fromXDR(text, Networks.TESTNET).hash().toString("hex"), transactionHashHex(t));
});

test("toHex", () => assert.equal(toHex(new Uint8Array([0, 15, 16, 255])), "000f10ff"));
