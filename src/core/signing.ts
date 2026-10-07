import { FeeBumpTransaction, hash, Keypair, TransactionBuilder, xdr, type Transaction } from "@stellar/stellar-base";
import { concat, equalBytes, fromBase64, toBase64, utf8 } from "./bytes.ts";
import { transactionXdr } from "./encode.ts";
import { invalidRequest, type WalletError } from "./errors.ts";

// What a wallet signs for dApps under SEP-43, and the checks before it does.

export type SignOptions = { networkPassphrase?: string; address?: string };
type Result<T> = { ok: true; value: T } | { ok: false; error: WalletError };

// stellar-base's types ask for Buffer, but its hashing and ed25519 code accept any Uint8Array.
const sha256 = (data: Uint8Array) => new Uint8Array(hash(data as never));

const fail = <T,>(...ext: string[]): Result<T> => ({ ok: false, error: invalidRequest(...ext) });

export function checkSignOptions(address: string, networkPassphrase: string, opts?: SignOptions): WalletError | null {
  if (opts?.networkPassphrase && opts.networkPassphrase !== networkPassphrase) {
    return invalidRequest(`This wallet is on "${networkPassphrase}", not "${opts.networkPassphrase}".`);
  }
  if (opts?.address && opts.address !== address) {
    return invalidRequest(`This wallet can't sign for ${opts.address}.`);
  }
  return null;
}

const checkOptions = (keypair: Keypair, networkPassphrase: string, opts?: SignOptions) =>
  checkSignOptions(keypair.publicKey(), networkPassphrase, opts);

export function parseAuthEntry(preimageXdr: string, networkPassphrase: string): Result<xdr.HashIdPreimage> {
  let preimage: xdr.HashIdPreimage;
  try {
    preimage = xdr.HashIdPreimage.fromXDR(preimageXdr, "base64");
  } catch {
    return fail("Invalid authorization entry XDR");
  }
  if (preimage.switch() !== xdr.EnvelopeType.envelopeTypeSorobanAuthorization()) {
    return fail("Only Soroban authorization entries can be signed");
  }
  if (!equalBytes(new Uint8Array(preimage.sorobanAuthorization().networkId()), sha256(utf8(networkPassphrase)))) {
    return fail("The authorization entry is for another network");
  }
  return { ok: true, value: preimage };
}

export function parseTransaction(txXdr: string, networkPassphrase: string): Result<Transaction | FeeBumpTransaction> {
  try {
    return { ok: true, value: TransactionBuilder.fromXDR(txXdr, networkPassphrase) };
  } catch {
    return fail("Invalid transaction XDR");
  }
}

export function signTransactionXdr(
  keypair: Keypair,
  txXdr: string,
  networkPassphrase: string,
  opts?: SignOptions,
): Result<{ signedTxXdr: string; signerAddress: string }> {
  const bad = checkOptions(keypair, networkPassphrase, opts);
  if (bad) return { ok: false, error: bad };
  const parsed = parseTransaction(txXdr, networkPassphrase);
  if (!parsed.ok) return parsed;
  parsed.value.sign(keypair);
  return { ok: true, value: { signedTxXdr: transactionXdr(parsed.value), signerAddress: keypair.publicKey() } };
}

// Signs the SHA-256 of the preimage, like the Stellar SDK's signAuthEntries and Freighter.
export function signAuthEntryXdr(
  keypair: Keypair,
  preimageXdr: string,
  networkPassphrase: string,
  opts?: SignOptions,
): Result<{ signedAuthEntry: string; signerAddress: string }> {
  const bad = checkOptions(keypair, networkPassphrase, opts);
  if (bad) return { ok: false, error: bad };
  const parsed = parseAuthEntry(preimageXdr, networkPassphrase);
  if (!parsed.ok) return parsed;
  const signature = keypair.sign(sha256(new Uint8Array(parsed.value.toXDR())) as never);
  return { ok: true, value: { signedAuthEntry: toBase64(new Uint8Array(signature)), signerAddress: keypair.publicKey() } };
}

const SEP53_PREFIX = "Stellar Signed Message:\n";

// SEP-53 signs SHA-256("Stellar Signed Message:\n" + message).
export function sep53Hash(message: string | Uint8Array) {
  const body = typeof message === "string" ? utf8(message) : message;
  return sha256(concat(utf8(SEP53_PREFIX), body));
}

export function signMessageText(
  keypair: Keypair,
  message: string,
  networkPassphrase: string,
  opts?: SignOptions,
): Result<{ signedMessage: string; signerAddress: string }> {
  const bad = checkOptions(keypair, networkPassphrase, opts);
  if (bad) return { ok: false, error: bad };
  if (typeof message !== "string") return fail("The message must be a string");
  const signature = new Uint8Array(keypair.sign(sep53Hash(message) as never));
  return { ok: true, value: { signedMessage: toBase64(signature), signerAddress: keypair.publicKey() } };
}

export function verifyMessage(address: string, message: string | Uint8Array, signatureBase64: string) {
  return Keypair.fromPublicKey(address).verify(sep53Hash(message) as never, fromBase64(signatureBase64) as never);
}
