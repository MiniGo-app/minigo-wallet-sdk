import { HOST_SOURCE, INPAGE_SOURCE, documentOrigin, selfOrigin } from "../../src/protocol.ts";

// Isolated-world content script: carries requests from the page's `window.mini` to the background worker and
// the answers back. It adds nothing of its own; the background uses the sender's real origin, not anything the
// page claims.

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== documentOrigin()) return;
  const data = event.data;
  if (!data || data.source !== INPAGE_SOURCE || typeof data.id !== "number") return;
  chrome.runtime.sendMessage({ kind: "inpage-request", request: data }, (response) => {
    if (chrome.runtime.lastError || !response) {
      window.postMessage(
        { source: HOST_SOURCE, type: "response", id: data.id, error: { code: -1, message: "MiniGo couldn't be reached. Reload the page and try again." } },
        selfOrigin(),
      );
      return;
    }
    window.postMessage(response, selfOrigin());
  });
});
