import type { Keypair } from "@stellar/stellar-base";
import { parseAsset } from "./core/assets.ts";
import { describeAuthEntry, describeTransaction, type AuthEntryDetails, type TransactionSummary } from "./core/describe.ts";
import { externalError, internalError, invalidRequest, isWalletError, tooManyPending, userRejected, type WalletError } from "./core/errors.ts";
import { buildPayment, submitTransaction } from "./core/horizon.ts";
import type { NetworkConfig } from "./core/network.ts";
import {
  checkSignOptions,
  parseAuthEntry,
  parseTransaction,
  signAuthEntryXdr,
  signMessageText,
  signTransactionXdr,
  type SignOptions,
} from "./core/signing.ts";
import { HOST_SOURCE, INPAGE_SOURCE, METHODS, type HostResponse, type Method } from "./protocol.ts";

// The wallet side of the protocol, shared by the extension and the app. The page is never trusted: every
// request is validated and approved by the user before the key is touched.

export type ApprovalRequest =
  | { kind: "connect"; origin: string; address: string }
  | { kind: "signTransaction"; origin: string; summary: TransactionSummary; submit: false }
  | { kind: "signAuthEntry"; origin: string; entryXdr: string; details: AuthEntryDetails }
  | { kind: "signMessage"; origin: string; message: string }
  | {
      kind: "payment";
      origin: string;
      to: string;
      amount: string;
      assetCode: string;
      memo?: string;
      createsAccount: boolean;
    };

export type HostContext = {
  network: NetworkConfig;
  address(): Promise<string | null>;
  // Only called after the user approved.
  keypair(): Promise<Keypair>;
  isAllowed(origin: string): Promise<boolean>;
  allow(origin: string): Promise<void>;
  approve(request: ApprovalRequest): Promise<boolean>;
  onPayment?(details: { origin: string; hash: string; to: string; amount: string; assetCode: string; memo?: string }): void;
};

type Parsed = { id: number; method: Method; params: Record<string, unknown> | undefined };

// Real requests are far smaller. These stop a hostile page from freezing the wallet or flooding the user.
export const MAX_REQUEST_LENGTH = 512 * 1024;
// Stellar's largest transactions are about 130 KB of base64.
export const MAX_XDR_LENGTH = 256 * 1024;
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const MAX_PENDING_APPROVALS = 3;

// There is one host per runtime, so the origin is enough of a key.
const pendingApprovals = new Map<string, number>();

async function approve(ctx: HostContext, request: ApprovalRequest): Promise<boolean> {
  const waiting = pendingApprovals.get(request.origin) ?? 0;
  if (waiting >= MAX_PENDING_APPROVALS) throw tooManyPending();
  pendingApprovals.set(request.origin, waiting + 1);
  try {
    return await ctx.approve(request);
  } finally {
    const left = (pendingApprovals.get(request.origin) ?? 1) - 1;
    if (left > 0) pendingApprovals.set(request.origin, left);
    else pendingApprovals.delete(request.origin);
  }
}

const xdrParam = (value: unknown, what: string) => {
  const text = str(value);
  if (!text) throw invalidRequest(`Missing ${what}`);
  if (text.length > MAX_XDR_LENGTH) throw invalidRequest(`The ${what} is too large`);
  return text;
};

export function parseRequest(raw: unknown): Parsed | null {
  let data = raw;
  if (typeof data === "string" && data.length > MAX_REQUEST_LENGTH) return null;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const { source, id, method, params } = data as Record<string, unknown>;
  if (source !== INPAGE_SOURCE || typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  if (typeof method !== "string") return null;
  return {
    id,
    method: method as Method,
    params: params && typeof params === "object" ? (params as Record<string, unknown>) : undefined,
  };
}

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

function signOptions(value: unknown): SignOptions | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { networkPassphrase, address } = value as Record<string, unknown>;
  return { networkPassphrase: str(networkPassphrase), address: str(address) };
}

// Refused before the user is asked, since they couldn't approve it anyway.
function refuseOptions(address: string, networkPassphrase: string, opts?: SignOptions) {
  const bad = checkSignOptions(address, networkPassphrase, opts);
  if (bad) throw bad;
}

async function ensureAllowed(ctx: HostContext, origin: string): Promise<{ address: string } | WalletError> {
  const address = await ctx.address();
  if (!address) return internalError(["Set up the wallet first."]);
  if (await ctx.isAllowed(origin)) return { address };
  if (!(await approve(ctx, { kind: "connect", origin, address }))) return userRejected();
  await ctx.allow(origin);
  return { address };
}

async function run(ctx: HostContext, origin: string, method: Method, params: Record<string, unknown> | undefined): Promise<unknown> {
  const { network } = ctx;
  switch (method) {
    case "isAllowed":
      return { isAllowed: await ctx.isAllowed(origin) };
    case "getNetwork":
      return {
        network: network.network,
        networkName: network.networkName,
        networkPassphrase: network.networkPassphrase,
        networkUrl: network.networkUrl,
        sorobanRpcUrl: network.sorobanRpcUrl,
      };
    case "getAddress":
      if (params?.prompt !== true) {
        const address = await ctx.address();
        return { address: address && (await ctx.isAllowed(origin)) ? address : "" };
      }
    // falls through
    case "requestAccess": {
      const allowed = await ensureAllowed(ctx, origin);
      if (isWalletError(allowed)) throw allowed;
      return { address: allowed.address };
    }
    case "signTransaction": {
      const xdr = xdrParam(params?.xdr, "transaction XDR");
      const opts = signOptions(params?.opts);
      const parsed = parseTransaction(xdr, network.networkPassphrase);
      if (!parsed.ok) throw parsed.error;
      const allowed = await ensureAllowed(ctx, origin);
      if (isWalletError(allowed)) throw allowed;
      refuseOptions(allowed.address, network.networkPassphrase, opts);
      if (!(await approve(ctx, { kind: "signTransaction", origin, summary: describeTransaction(parsed.value, allowed.address), submit: false }))) {
        throw userRejected();
      }
      const signed = signTransactionXdr(await ctx.keypair(), xdr, network.networkPassphrase, opts);
      if (!signed.ok) throw signed.error;
      return signed.value;
    }
    case "signAuthEntry": {
      const entryXdr = xdrParam(params?.authEntry, "authorization entry");
      const opts = signOptions(params?.opts);
      const entry = parseAuthEntry(entryXdr, network.networkPassphrase);
      if (!entry.ok) throw entry.error;
      const allowed = await ensureAllowed(ctx, origin);
      if (isWalletError(allowed)) throw allowed;
      refuseOptions(allowed.address, network.networkPassphrase, opts);
      if (!(await approve(ctx, { kind: "signAuthEntry", origin, entryXdr, details: describeAuthEntry(entry.value) }))) throw userRejected();
      const signed = signAuthEntryXdr(await ctx.keypair(), entryXdr, network.networkPassphrase, opts);
      if (!signed.ok) throw signed.error;
      return signed.value;
    }
    case "signMessage": {
      const message = str(params?.message);
      const opts = signOptions(params?.opts);
      if (message === undefined) throw invalidRequest("Missing message");
      if (new TextEncoder().encode(message).length > MAX_MESSAGE_BYTES) throw invalidRequest("The message is too large to sign");
      const allowed = await ensureAllowed(ctx, origin);
      if (isWalletError(allowed)) throw allowed;
      refuseOptions(allowed.address, network.networkPassphrase, opts);
      if (!(await approve(ctx, { kind: "signMessage", origin, message }))) throw userRejected();
      const signed = signMessageText(await ctx.keypair(), message, network.networkPassphrase, opts);
      if (!signed.ok) throw signed.error;
      return signed.value;
    }
    case "requestPayment": {
      const to = str(params?.to);
      const amount = typeof params?.amount === "number" ? String(params.amount) : str(params?.amount);
      const memo = str(params?.memo);
      const asset = parseAsset(str(params?.asset), network.network);
      if (!to || !/^G[A-Z2-7]{55}$/.test(to)) throw invalidRequest("`to` must be a Stellar address");
      if (!amount || !/^\d+(\.\d{1,7})?$/.test(amount) || !(Number(amount) > 0)) throw invalidRequest("`amount` must be a positive number with up to 7 decimals");
      if (!asset) throw invalidRequest('`asset` must be "XLM", "USDC" or "CODE:ISSUER"');
      if (memo !== undefined && new TextEncoder().encode(memo).length > 28) throw invalidRequest("`memo` can be at most 28 bytes");
      const allowed = await ensureAllowed(ctx, origin);
      if (isWalletError(allowed)) throw allowed;
      const plan = await buildPayment(network, { source: allowed.address, to, asset, amount, memo });
      const assetCode = asset.isNative() ? "XLM" : asset.getCode();
      const approved = await approve(ctx, { kind: "payment", origin, to, amount, assetCode, memo, createsAccount: plan.createsAccount });
      if (!approved) throw userRejected();
      // Rebuild so the sequence number and time bounds are fresh after the user took their time.
      const fresh = await buildPayment(network, { source: allowed.address, to, asset, amount, memo });
      if (fresh.createsAccount !== plan.createsAccount) throw externalError("The recipient's account changed while you were deciding. Try again.");
      fresh.tx.sign(await ctx.keypair());
      const { hash } = await submitTransaction(network, fresh.tx);
      ctx.onPayment?.({ origin, hash, to, amount, assetCode, memo });
      return { hash };
    }
  }
}

// Returns null for anything that isn't a request, which the caller ignores.
export async function handleRequest(ctx: HostContext, origin: string, raw: unknown): Promise<HostResponse | null> {
  const request = parseRequest(raw);
  if (!request) return null;
  const respond = (body: { result?: unknown; error?: WalletError }): HostResponse => ({
    source: HOST_SOURCE,
    type: "response",
    id: request.id,
    ...body,
  });
  if (!METHODS.includes(request.method)) {
    return respond({ error: invalidRequest(`Unknown method: ${String(request.method).slice(0, 40)}`) });
  }
  try {
    return respond({ result: await run(ctx, origin, request.method, request.params) });
  } catch (error) {
    if (isWalletError(error)) return respond({ error });
    console.error("[MiniGo] request failed", request.method, error);
    return respond({ error: internalError() });
  }
}
