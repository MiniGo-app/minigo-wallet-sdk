// The gate every message from a mini app's WebView passes before it reaches the wallet host.
//
// Why it exists: a WebView delivers messages from the page *and from every iframe inside it* through the same
// channel, and depending on the platform the URL that comes with a message is the page's, not the sender's
// (react-native-webview on Android falls back to `addJavascriptInterface`, which is exposed to all frames and
// reports the top-level URL). So "which origin sent this?" can't be answered from the message alone, and an
// iframe inside an approved app could be attributed to that app.
//
// So the wallet does not try to identify the sender frame. It hands a secret nonce to the main frame only
// (injected as a script into the top document, never into subframes) and accepts a message only if it carries
// that nonce. Cross-origin frames cannot read the main frame's memory, so they cannot produce it. The sender
// URL is still checked as a second layer where the platform reports it correctly.

import { INPAGE_SOURCE } from "./protocol.ts";

export type BridgeAuth = {
  /** Secret handed to the main frame; a fresh one per WebView instance. */
  nonce: string;
  /** For URL apps: the only origin allowed to talk to the wallet. */
  appOrigin?: string | null;
};

export type GateVerdict = { ok: true; raw: string } | { ok: false; reason: "not-json" | "not-a-request" | "bad-nonce" | "wrong-origin" };

// Compares without stopping at the first difference (the nonce is a secret; the page is untrusted).
function sameSecret(a: unknown, b: string): boolean {
  if (typeof a !== "string" || a.length !== b.length || b.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Decides whether a message received from the WebView may be treated as a wallet request from the approved app.
 * `senderOrigin` is the origin the platform reported for the message (best effort, see above). On success the
 * returned `raw` is the request with the nonce removed, ready for the host.
 */
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

/** The script that gives the main frame its nonce. The provider reads it once and removes it. */
export const nonceScript = (nonce: string) => `globalThis.__minigoNonce=${JSON.stringify(nonce)};`;

/**
 * Web preview (a mini app in an <iframe> of the MiniGo web app). There the browser tells us the real sender:
 * `event.source` is the window that posted the message, so a frame nested inside the app's frame is a different
 * window and is rejected. `appOrigin` is set for URL apps.
 */
export function acceptWebFrameMessage(
  event: { source: unknown; origin: string },
  appWindow: unknown,
  appOrigin?: string | null,
): boolean {
  if (!appWindow || event.source !== appWindow) return false;
  return !appOrigin || event.origin === appOrigin;
}
