import { createCaller, createProvider, installProvider } from "./provider.ts";
import { installFreighterCompat } from "./freighter.ts";

// Entry for pages running inside MiniGo: injected into the React Native WebView before any page script
// (`injectedJavaScriptBeforeContentLoaded`), or included by a page that MiniGo's web preview shows in an
// iframe. No real Freighter exists there, so the Freighter fallback is always on.

type RNWebView = { postMessage(data: string): void };
const w = window as unknown as { ReactNativeWebView?: RNWebView; mini?: { isMiniGo?: boolean }; __minigoNonce?: string };

// MiniGo hands the top document a secret nonce and only accepts requests that carry it (src/bridge-gate.ts), so
// an iframe inside the app can't speak for it. Take it into this closure and remove it from the page.
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
      // Native answers arrive through window.__minigoHostResponse; web answers come from the parent frame.
      (source) => inFrame && source === window.parent,
    );
    installProvider(createProvider(call), native ? "mobile" : "web");
    installFreighterCompat(call);
  }
}
