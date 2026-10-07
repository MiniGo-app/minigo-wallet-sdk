import { acceptWebFrameMessage } from "../../../src/bridge-gate.ts";

// The check MiniAppFrame.web.tsx makes.
const frame = document.getElementById("app") as HTMLIFrameElement;
const appOrigin = new URL(frame.src).origin;
const accepted: { origin: string; method: string }[] = [];
const rejected: { origin: string; method: string }[] = [];

window.addEventListener("message", (event: MessageEvent) => {
  let method = "?";
  try {
    method = JSON.parse(event.data).method;
  } catch {}
  (acceptWebFrameMessage(event, frame.contentWindow, appOrigin) ? accepted : rejected).push({ origin: event.origin, method });
});
(window as unknown as Record<string, unknown>).__web = { accepted, rejected };
