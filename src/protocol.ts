import type { WalletError } from "./core/errors.ts";
import type { SignOptions } from "./core/signing.ts";

// Messages between the in-page provider and the wallet host. The page only asks; the host decides.

export const INPAGE_SOURCE = "minigo-inpage";
export const HOST_SOURCE = "minigo-host";
export const PROVIDER_VERSION = "0.1.0";

// Not location.origin: a page sandboxed by CSP keeps its URL's origin there but really runs as "null".
export const documentOrigin = () => (globalThis as { origin?: string }).origin ?? window.location.origin;

// "null" can't be a postMessage target, and the message goes to this same window anyway.
export const selfOrigin = () => {
  const origin = documentOrigin();
  return origin === "null" ? "*" : origin;
};

export type Sentinel = { provider: "minigo"; platform: "extension" | "mobile" | "web"; version: string };

export type PaymentParams = {
  to: string;
  amount: string;
  // "XLM" (the default), "USDC" or "CODE:ISSUER".
  asset?: string;
  memo?: string;
};

export type RequestMap = {
  isAllowed: { params: undefined; result: { isAllowed: boolean } };
  requestAccess: { params: undefined; result: { address: string } };
  // With prompt false, "" unless the site is already allowed.
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
  // Only inside the MiniGo app, see bridge-gate.ts.
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
