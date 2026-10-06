import type { WalletError } from "./core/errors.ts";
import type { SignOptions } from "./core/signing.ts";

// Messages between the in-page provider (untrusted page context) and the wallet host (the extension's
// background worker, or the MiniGo app). The host decides everything; the page only asks.

export const INPAGE_SOURCE = "minigo-inpage";
export const HOST_SOURCE = "minigo-host";
export const PROVIDER_VERSION = "0.1.0";

/**
 * The document's real origin. Not `location.origin`: a page served with a CSP sandbox keeps its URL's origin in
 * `location` but runs with the opaque origin "null", and only `self.origin` says so.
 */
export const documentOrigin = () => (globalThis as { origin?: string }).origin ?? window.location.origin;

/**
 * Target origin for a message a page posts to itself. An opaque origin ("null") can't be named as a target, so
 * those pages use "*": the target is this same window either way.
 */
export const selfOrigin = () => {
  const origin = documentOrigin();
  return origin === "null" ? "*" : origin;
};

/** The detection sentinel other code can check without calling the wallet. */
export type Sentinel = { provider: "minigo"; platform: "extension" | "mobile" | "web"; version: string };

export type PaymentParams = {
  to: string;
  amount: string;
  /** "XLM" (default), "USDC", or "CODE:ISSUER" for any other Stellar asset. */
  asset?: string;
  memo?: string;
};

export type RequestMap = {
  isAllowed: { params: undefined; result: { isAllowed: boolean } };
  requestAccess: { params: undefined; result: { address: string } };
  /** Without a prompt: the address if this site is already allowed, otherwise "". */
  getAddress: { params: { prompt: boolean }; result: { address: string } };
  getNetwork: {
    params: undefined;
    result: { network: string; networkPassphrase: string; networkUrl: string; sorobanRpcUrl: string; networkName: string };
  };
  signTransaction: { params: { xdr: string; opts?: SignOptions }; result: { signedTxXdr: string; signerAddress: string } };
  signAuthEntry: { params: { authEntry: string; opts?: SignOptions }; result: { signedAuthEntry: string; signerAddress: string } };
  signMessage: { params: { message: string; opts?: SignOptions }; result: { signedMessage: string; signerAddress: string } };
  requestPayment: { params: PaymentParams; result: { hash: string } };
};

export type Method = keyof RequestMap;

export type InpageRequest<M extends Method = Method> = {
  source: typeof INPAGE_SOURCE;
  id: number;
  method: M;
  params: RequestMap[M]["params"];
  /** Inside the MiniGo app only: proves the request came from the main frame (see bridge-gate.ts). */
  nonce?: string;
};

export type HostResponse = {
  source: typeof HOST_SOURCE;
  type: "response";
  id: number;
  result?: unknown;
  error?: WalletError;
};

export const METHODS: readonly Method[] = [
  "isAllowed",
  "requestAccess",
  "getAddress",
  "getNetwork",
  "signTransaction",
  "signAuthEntry",
  "signMessage",
  "requestPayment",
];
