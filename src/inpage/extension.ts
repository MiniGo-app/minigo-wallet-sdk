import { installFreighterCompat } from "./freighter.ts";
import { selfOrigin } from "../protocol.ts";
import { createCaller, createProvider, installProvider } from "./provider.ts";

// The extension's main-world content script. It is built with and without the Freighter fallback, and the
// background registers the one the user picked.

declare const __FREIGHTER_COMPAT__: boolean;

const call = createCaller(
  (request) => window.postMessage(request, selfOrigin()),
  (source) => source === window,
);
installProvider(createProvider(call), "extension");
if (__FREIGHTER_COMPAT__) installFreighterCompat(call);
