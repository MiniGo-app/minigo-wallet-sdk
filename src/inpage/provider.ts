import { internalError, isWalletError, type WalletError } from "../core/errors.ts";
import type { SignOptions } from "../core/signing.ts";
import {
  HOST_SOURCE,
  INPAGE_SOURCE,
  PROVIDER_VERSION,
  type HostResponse,
  type InpageRequest,
  type Method,
  type PaymentParams,
  type RequestMap,
  type Sentinel,
} from "../protocol.ts";

// `window.mini`: MiniGo's SEP-43 provider. Every method resolves — never throws — with either its result or
// `{ error }`, exactly as SEP-43 specifies. The page never sees keys; each call is a message to the host.

export type Transport = (request: InpageRequest) => void;

type Pending = { resolve: (response: HostResponse) => void };

export type Call = <M extends Method>(method: M, params: RequestMap[M]["params"]) => Promise<
  { ok: true; result: RequestMap[M]["result"] } | { ok: false; error: WalletError }
>;

export function createCaller(transport: Transport, acceptFrom: (source: MessageEventSource | null) => boolean): Call {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const settle = (response: HostResponse) => {
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    waiting.resolve(response);
  };

  window.addEventListener("message", (event: MessageEvent) => {
    if (!acceptFrom(event.source)) return;
    let data = event.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (data?.source === HOST_SOURCE && data.type === "response" && typeof data.id === "number") settle(data);
  });
  // React Native hosts answer by evaluating this in the page.
  Object.defineProperty(window, "__minigoHostResponse", { value: (response: HostResponse) => settle(response) });

  return (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, {
        resolve: (response) => {
          if (response.error) resolve({ ok: false, error: isWalletError(response.error) ? response.error : internalError() });
          else resolve({ ok: true, result: response.result as never });
        },
      });
      try {
        transport({ source: INPAGE_SOURCE, id, method, params } as InpageRequest);
      } catch {
        pending.delete(id);
        resolve({ ok: false, error: internalError(["MiniGo is not reachable from this page"]) });
      }
    });
}

type Resolved<T> = Promise<T & { error?: WalletError }>;

export type MiniProvider = {
  readonly isMiniGo: true;
  readonly version: string;
  isConnected(): Promise<{ isConnected: boolean }>;
  isAllowed(): Resolved<{ isAllowed: boolean }>;
  requestAccess(): Resolved<{ address: string }>;
  getAddress(): Resolved<{ address: string }>;
  getNetwork(): Resolved<{ network: string; networkPassphrase: string }>;
  signTransaction(xdr: string, opts?: SignOptions): Resolved<{ signedTxXdr: string; signerAddress: string }>;
  signAuthEntry(authEntry: string, opts?: SignOptions): Resolved<{ signedAuthEntry: string; signerAddress: string }>;
  signMessage(message: string, opts?: SignOptions): Resolved<{ signedMessage: string; signerAddress: string }>;
  requestPayment(payment: PaymentParams): Resolved<{ hash: string }>;
};

export function createProvider(call: Call): MiniProvider {
  const run = async <M extends Method, T extends object>(method: M, params: RequestMap[M]["params"], empty: T, pick: (r: RequestMap[M]["result"]) => T) => {
    const response = await call(method, params);
    return response.ok ? pick(response.result) : { ...empty, error: response.error };
  };
  const sig = (opts?: SignOptions) => (opts ? { networkPassphrase: opts.networkPassphrase, address: opts.address } : undefined);

  return Object.freeze({
    isMiniGo: true as const,
    version: PROVIDER_VERSION,
    isConnected: async () => ({ isConnected: true }),
    isAllowed: () => run("isAllowed", undefined, { isAllowed: false }, (r) => ({ isAllowed: r.isAllowed })),
    requestAccess: () => run("requestAccess", undefined, { address: "" }, (r) => ({ address: r.address })),
    // SEP-43: getAddress does whatever it takes to return an address, including asking the user.
    getAddress: () => run("getAddress", { prompt: true }, { address: "" }, (r) => ({ address: r.address })),
    getNetwork: () =>
      run("getNetwork", undefined, { network: "", networkPassphrase: "" }, (r) => ({ network: r.network, networkPassphrase: r.networkPassphrase })),
    signTransaction: (xdr, opts) =>
      run("signTransaction", { xdr: String(xdr), opts: sig(opts) }, { signedTxXdr: "", signerAddress: "" }, (r) => r),
    signAuthEntry: (authEntry, opts) =>
      run("signAuthEntry", { authEntry: String(authEntry), opts: sig(opts) }, { signedAuthEntry: "", signerAddress: "" }, (r) => r),
    signMessage: (message, opts) =>
      run("signMessage", { message: String(message), opts: sig(opts) }, { signedMessage: "", signerAddress: "" }, (r) => r),
    requestPayment: (payment) => run("requestPayment", { ...payment }, { hash: "" }, (r) => ({ hash: r.hash })),
  });
}

/** Installs `window.mini`, the `window.stellar` sentinel, and announces itself with `minigo#initialized`. */
export function installProvider(provider: MiniProvider, platform: Sentinel["platform"]) {
  const w = window as unknown as { mini?: MiniProvider; stellar?: Sentinel };
  if (w.mini?.isMiniGo) return w.mini;
  Object.defineProperty(window, "mini", { value: provider, configurable: false, enumerable: true });
  if (!w.stellar) {
    Object.defineProperty(window, "stellar", {
      value: Object.freeze({ provider: "minigo", platform, version: PROVIDER_VERSION } satisfies Sentinel),
      configurable: false,
      enumerable: true,
    });
  }
  window.dispatchEvent(new Event("minigo#initialized"));
  return provider;
}
