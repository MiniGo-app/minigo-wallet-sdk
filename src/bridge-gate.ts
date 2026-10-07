// A WebView delivers messages from the page and from every iframe in it through one channel, and on Android's
// fallback path the URL that comes with a message is the top-level one. So the URL alone can't tell an iframe
// from the app. The main frame gets a secret nonce and only messages carrying it are accepted. The sender URL
// is still checked where the platform reports it correctly.

import { INPAGE_SOURCE } from "./protocol.ts";

export type BridgeAuth = {
  nonce: string;
  // URL apps only.
  appOrigin?: string | null;
};

export type GateVerdict = { ok: true; raw: string } | { ok: false; reason: "not-json" | "not-a-request" | "bad-nonce" | "wrong-origin" };

// Constant time, since the nonce is a secret.
function sameSecret(a: unknown, b: string): boolean {
  if (typeof a !== "string" || a.length !== b.length || b.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// On success `raw` is the request without the nonce.
export function gateBridgeMessage(data: unknown, senderOrigin: string | null, auth: BridgeAuth): GateVerdict {
  let parsed: unknown;
  try {
    parsed = typeof data === "string" ? JSON.parse(data) : data;
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!parsed || typeof parsed !== "object" || (parsed as { source?: unknown }).source !== INPAGE_SOURCE) {
    return { ok: false, reason: "not-a-request" };
  }
  const { nonce, ...request } = parsed as Record<string, unknown>;
  if (!sameSecret(nonce, auth.nonce)) return { ok: false, reason: "bad-nonce" };
  if (auth.appOrigin && senderOrigin !== auth.appOrigin) return { ok: false, reason: "wrong-origin" };
  return { ok: true, raw: JSON.stringify(request) };
}

// The provider reads this once and deletes it.
export const nonceScript = (nonce: string) => `globalThis.__minigoNonce=${JSON.stringify(nonce)};`;

// In the web preview `event.source` is the real sender, so a frame nested in the app's frame is rejected.
export function acceptWebFrameMessage(
  event: { source: unknown; origin: string },
  appWindow: unknown,
  appOrigin?: string | null,
): boolean {
  if (!appWindow || event.source !== appWindow) return false;
  return !appOrigin || event.origin === appOrigin;
}
