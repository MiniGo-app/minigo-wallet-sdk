import { createCaller, createProvider, installProvider } from "./provider.ts";
import { installFreighterCompat } from "./freighter.ts";

// Injected into mini apps in the MiniGo app, or included by pages shown in the web preview. There is no real
// Freighter there, so the Freighter fallback is always on.

type RNWebView = { postMessage(data: string): void };
const w = window as unknown as { ReactNativeWebView?: RNWebView; mini?: { isMiniGo?: boolean }; __minigoNonce?: string };

// Keep the nonce in this closure and take it off the page (see bridge-gate.ts).
const nonce = w.__minigoNonce;
try {
  delete w.__minigoNonce;
} catch {
  w.__minigoNonce = undefined;
}

if (!w.mini?.isMiniGo) {
  const native = w.ReactNativeWebView;
  const inFrame = window.parent !== window;
  if (native || inFrame) {
    const call = createCaller(
      (request) => {
        if (native) native.postMessage(JSON.stringify({ ...request, nonce }));
        else window.parent.postMessage(JSON.stringify(request), "*");
      },
      // Native answers come through window.__minigoHostResponse.
      (source) => inFrame && source === window.parent,
    );
    installProvider(createProvider(call), native ? "mobile" : "web");
    installFreighterCompat(call);
  }
}
