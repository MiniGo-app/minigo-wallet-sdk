import { invalidRequest, type WalletError } from "../core/errors.ts";
import { selfOrigin } from "../protocol.ts";
import type { Call } from "./provider.ts";

// Freighter compatibility (fallback). Many Stellar dApps only speak Freighter — directly through
// `@stellar/freighter-api`, or through Stellar Wallets Kit's default Freighter module. Where no real
// Freighter can exist (inside the MiniGo app), or when the user opts in on the extension, MiniGo answers
// Freighter's page messages itself, backed by the same host calls as `window.mini`.
//
// Protocol source: @stellar/freighter-api 6.x (`@shared/api/external.ts`). Note Freighter's own spelling of
// `messagedId` in responses.

const REQUEST = "FREIGHTER_EXTERNAL_MSG_REQUEST";
const RESPONSE = "FREIGHTER_EXTERNAL_MSG_RESPONSE";

type FreighterRequest = {
  source: typeof REQUEST;
  messageId: number;
  type: string;
  transactionXdr?: string;
  entryXdr?: string;
  blob?: string;
  networkPassphrase?: string;
  accountToSign?: string;
};

type Answer = Record<string, unknown> & { apiError?: WalletError };

async function answer(call: Call, request: FreighterRequest): Promise<Answer> {
  const opts = { networkPassphrase: request.networkPassphrase, address: request.accountToSign };
  switch (request.type) {
    case "REQUEST_CONNECTION_STATUS":
      return { isConnected: true };
    case "REQUEST_ALLOWED_STATUS": {
      const r = await call("isAllowed", undefined);
      return r.ok ? { isAllowed: r.result.isAllowed } : { isAllowed: false, apiError: r.error };
    }
    case "SET_ALLOWED_STATUS": {
      const r = await call("requestAccess", undefined);
      return r.ok ? { isAllowed: true } : { isAllowed: false, apiError: r.error };
    }
    case "REQUEST_ACCESS": {
      const r = await call("requestAccess", undefined);
      return r.ok ? { publicKey: r.result.address } : { publicKey: "", apiError: r.error };
    }
    // Like Freighter: the public key only for sites the user already allowed, otherwise "".
    case "REQUEST_PUBLIC_KEY":
    case "REQUEST_USER_INFO": {
      const r = await call("getAddress", { prompt: false });
      return r.ok ? { publicKey: r.result.address } : { publicKey: "", apiError: r.error };
    }
    case "REQUEST_NETWORK":
    case "REQUEST_NETWORK_DETAILS": {
      const r = await call("getNetwork", undefined);
      if (!r.ok) return { apiError: r.error };
      const { network, networkName, networkUrl, networkPassphrase, sorobanRpcUrl } = r.result;
      return { network, networkDetails: { network, networkName, networkUrl, networkPassphrase, sorobanRpcUrl } };
    }
    case "SUBMIT_TRANSACTION": {
      const r = await call("signTransaction", { xdr: String(request.transactionXdr ?? ""), opts });
      return r.ok
        ? { signedTransaction: r.result.signedTxXdr, signerAddress: r.result.signerAddress }
        : { signedTransaction: "", signerAddress: "", apiError: r.error };
    }
    case "SUBMIT_AUTH_ENTRY": {
      const r = await call("signAuthEntry", { authEntry: String(request.entryXdr ?? ""), opts });
      return r.ok
        ? { signedAuthEntry: r.result.signedAuthEntry, signerAddress: r.result.signerAddress }
        : { signedAuthEntry: null, signerAddress: "", apiError: r.error };
    }
    case "SUBMIT_BLOB": {
      const r = await call("signMessage", { message: String(request.blob ?? ""), opts });
      return r.ok
        ? { signedBlob: r.result.signedMessage, signerAddress: r.result.signerAddress }
        : { signedBlob: null, signerAddress: "", apiError: r.error };
    }
    case "SUBMIT_TOKEN":
      return { contractId: "", apiError: invalidRequest("MiniGo doesn't track Soroban token contracts yet") };
    default:
      return { apiError: invalidRequest(`Unsupported Freighter request: ${String(request.type).slice(0, 40)}`) };
  }
}

export function installFreighterCompat(call: Call) {
  const w = window as unknown as { freighter?: unknown };
  // Never take over from a real Freighter.
  if (w.freighter !== undefined) return false;
  Object.defineProperty(window, "freighter", { value: true, configurable: false, enumerable: true });

  window.addEventListener("message", async (event: MessageEvent) => {
    if (event.source !== window) return;
    const request = event.data as FreighterRequest | null;
    if (!request || request.source !== REQUEST || typeof request.type !== "string") return;
    const reply = await answer(call, request);
    window.postMessage({ source: RESPONSE, messagedId: request.messageId, ...reply }, selfOrigin());
  });
  return true;
}
