import type { FeeBumpTransaction, Transaction } from "@stellar/stellar-base";
import { toBase64 } from "./bytes.ts";

// stellar-base returns XDR as a polyfilled Buffer and turns it into text with `buffer.toString("base64")`. That only
// works where `subarray` on a Buffer returns a Buffer. V8 (browsers, Node) does; Hermes, the engine behind React
// Native, returns a plain Uint8Array, and `Uint8Array.toString()` is a comma-separated list of numbers. A transaction
// sent that way is rejected as malformed. So text is made here from the raw bytes, which is the same on every engine.

const HEX = "0123456789abcdef";

export function toHex(bytes: ArrayLike<number>) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return out;
}

/** The transaction as base64 XDR (what Horizon and wallets exchange). */
export function transactionXdr(tx: Transaction | FeeBumpTransaction) {
  return toBase64(new Uint8Array(tx.toEnvelope().toXDR()));
}

export function transactionHashHex(tx: Transaction | FeeBumpTransaction) {
  return toHex(new Uint8Array(tx.hash()));
}
