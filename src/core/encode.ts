import type { FeeBumpTransaction, Transaction } from "@stellar/stellar-base";
import { toBase64 } from "./bytes.ts";

// stellar-base turns XDR into text with Buffer#toString, but on Hermes a sliced Buffer is a plain Uint8Array and
// prints as "0,0,0,2,...". Encoding the raw bytes here gives the same result on every engine.

const HEX = "0123456789abcdef";

export function toHex(bytes: ArrayLike<number>) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return out;
}

export function transactionXdr(tx: Transaction | FeeBumpTransaction) {
  return toBase64(new Uint8Array(tx.toEnvelope().toXDR()));
}

export function transactionHashHex(tx: Transaction | FeeBumpTransaction) {
  return toHex(new Uint8Array(tx.hash()));
}
