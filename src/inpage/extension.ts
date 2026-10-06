import { installFreighterCompat } from "./freighter.ts";
import { selfOrigin } from "../protocol.ts";
import { createCaller, createProvider, installProvider } from "./provider.ts";

// Entry for the browser extension. Registered as a main-world content script at document_start, so it's in
// place before any page script. Requests go to the extension's isolated content script via
// window.postMessage, which relays them to the background worker.
//
// Built twice: with and without the Freighter fallback. The background registers the one matching the
// user's setting (off by default in browsers, where the real Freighter may be installed).

declare const __FREIGHTER_COMPAT__: boolean;

const call = createCaller(
  (request) => window.postMessage(request, selfOrigin()),
  (source) => source === window,
);
installProvider(createProvider(call), "extension");
if (__FREIGHTER_COMPAT__) installFreighterCompat(call);
