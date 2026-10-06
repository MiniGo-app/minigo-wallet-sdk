import { Keypair } from "@stellar/stellar-base";
import { TESTNET } from "../../src/core/network.ts";
import { invalidRequest } from "../../src/core/errors.ts";
import { handleRequest, type ApprovalRequest, type HostContext } from "../../src/host.ts";
import { HOST_SOURCE } from "../../src/protocol.ts";

// Background worker: owns the key, the list of allowed sites and the approval queue. Testnet only — the key is
// generated on first run and kept in chrome.storage.local, which is fine for a test wallet and not for real funds.

type Stored = { secret?: string; allowed?: string[]; freighterCompat?: boolean };
const store = {
  get: <K extends keyof Stored>(key: K) => chrome.storage.local.get(key).then((v) => v[key] as Stored[K]),
  set: (value: Stored) => chrome.storage.local.set(value),
};

// Made once and shared: on first run, onInstalled and a page's first request can both ask for the key before
// either has stored it, and two separate checks would each create (and store) a different one.
let loadingKey: Promise<Keypair> | null = null;
function keypair() {
  loadingKey ??= (async () => {
    let secret = await store.get("secret");
    if (!secret) {
      secret = Keypair.random().secret();
      await store.set({ secret });
    }
    return Keypair.fromSecret(secret);
  })().catch((error) => {
    loadingKey = null;
    throw error;
  });
  return loadingKey;
}

// Only real web origins get a permission of their own. Sandboxed pages and data: URLs all report "null", and
// file: pages all share "file://", so allowing one would allow every other page like it.
const webOrigin = (sender: chrome.runtime.MessageSender) => {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
  return /^https?:\/\/[^/]+$/.test(origin) ? origin : null;
};

// ---- main-world provider registration (with or without the Freighter fallback)
const SCRIPT_ID = "minigo-inpage";
async function registerProvider() {
  const compat = (await store.get("freighterCompat")) === true;
  await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: ["<all_urls>"],
      js: [compat ? "inpage.freighter.js" : "inpage.js"],
      runAt: "document_start",
      world: "MAIN",
      persistAcrossSessions: true,
    },
  ]);
}
chrome.runtime.onInstalled.addListener(() => {
  keypair();
  registerProvider();
});
chrome.runtime.onStartup.addListener(registerProvider);

// ---- approvals: one window per request, answered from approve.html
type Pending = { request: ApprovalRequest; resolve: (ok: boolean) => void; windowId?: number };
const pending = new Map<string, Pending>();

function approve(request: ApprovalRequest) {
  return new Promise<boolean>((resolve) => {
    const id = crypto.randomUUID();
    pending.set(id, { request, resolve });
    chrome.windows.create({ url: chrome.runtime.getURL(`approve.html?id=${id}`), type: "popup", width: 400, height: 600, focused: true }, (win) => {
      const entry = pending.get(id);
      if (entry && win) entry.windowId = win.id;
    });
  });
}

function settle(id: string, ok: boolean) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  entry.resolve(ok);
}

// Closing the window counts as "no".
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, entry] of pending) if (entry.windowId === windowId) settle(id, false);
});

const context: HostContext = {
  network: TESTNET,
  address: async () => (await keypair()).publicKey(),
  keypair,
  isAllowed: async (origin) => ((await store.get("allowed")) ?? []).includes(origin),
  allow: async (origin) => {
    const allowed = (await store.get("allowed")) ?? [];
    if (!allowed.includes(origin)) await store.set({ allowed: [...allowed, origin] });
  },
  approve,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fromExtensionPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(""));

  // Requests from pages, relayed by relay.js. The origin comes from Chrome, never from the page.
  if (message?.kind === "inpage-request" && !fromExtensionPage) {
    const origin = webOrigin(sender);
    if (!sender.tab) return false;
    if (!origin) {
      const id = typeof message.request?.id === "number" ? message.request.id : 0;
      sendResponse({ source: HOST_SOURCE, type: "response", id, error: invalidRequest("MiniGo only works on http:// and https:// sites.") });
      return false;
    }
    handleRequest(context, origin, message.request).then((response) => sendResponse(response));
    return true;
  }

  // Extension pages only (popup, approval window) from here on.
  if (!fromExtensionPage) return false;
  switch (message?.kind) {
    case "approval-details":
      sendResponse(pending.get(message.id)?.request ?? null);
      return false;
    case "approval-decision":
      settle(message.id, message.ok === true);
      sendResponse(true);
      return false;
    case "wallet-state":
      Promise.all([keypair(), store.get("allowed"), store.get("freighterCompat")]).then(([kp, allowed, compat]) =>
        sendResponse({ address: kp.publicKey(), allowed: allowed ?? [], freighterCompat: compat === true, network: TESTNET }),
      );
      return true;
    case "set-freighter-compat":
      store.set({ freighterCompat: message.value === true }).then(registerProvider).then(() => sendResponse(true));
      return true;
    case "forget-site":
      store.get("allowed").then((allowed) => store.set({ allowed: (allowed ?? []).filter((o) => o !== message.origin) })).then(() => sendResponse(true));
      return true;
  }
  return false;
});
