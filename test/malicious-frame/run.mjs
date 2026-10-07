// Checks that an iframe inside an approved mini app can't use the wallet bridge as if it were the app.
//
// A WebView delivers messages from the page and from every frame inside it through one channel, and the URL
// that comes with a message isn't always the sender's. This models the worst case in Chromium:
// - window.ReactNativeWebView exists in every frame (Android's fallback path does this)
// - the provider and the nonce are injected into the main frame only
// - the wallet is told either the top-level URL (Android fallback) or the real frame's URL (iOS)
// Each case runs against the old check (origin only) and the gate (nonce and origin) with the SDK's real code.
// It doesn't replace trying it on a phone.
import { build } from "esbuild";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, Asset, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-base";
import { chromium } from "playwright-core";
import { gateBridgeMessage } from "../../src/bridge-gate.ts";
import { TESTNET } from "../../src/core/network.ts";
import { handleRequest } from "../../src/host.ts";

const here = dirname(fileURLToPath(import.meta.url));
const providerFile = join(here, "../../dist/inpage.embedded.js");
if (!existsSync(providerFile)) throw new Error("Run npm run build first");
const provider = readFileSync(providerFile, "utf8");

// `--serve HOST` only serves the pages, for trying them in MiniGo on a phone (HOST is your machine's address).
// Otherwise the app is on 127.0.0.1:4811 and the frame on localhost:4812, which are different origins.
const serveOnly = process.argv.includes("--serve");
const HOST = serveOnly ? (process.argv[process.argv.indexOf("--serve") + 1] ?? "127.0.0.1") : null;
const APP = `http://${HOST ?? "127.0.0.1"}:4811`;
const EVIL = `http://${HOST ?? "localhost"}:4812`;
const originOf = (url) => /^(https?:\/\/[^/?#]+)/i.exec(url.trim())?.[1].toLowerCase() ?? null;

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
};

const walletKey = Keypair.random();
const xdr = new TransactionBuilder(new Account(walletKey.publicKey(), "1"), { fee: "100", networkPassphrase: TESTNET.networkPassphrase })
  .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
  .setTimeout(300)
  .build()
  .toXDR();

const webHost = join(mkdtempSync(join(tmpdir(), "minigo-frame-")), "web-host.js");
await build({ entryPoints: [join(here, "pages/web-host.entry.ts")], outfile: webHost, bundle: true, format: "iife", logLevel: "error" });
const fill = (html, { providerTag = "" } = {}) =>
  html.replaceAll("__EVIL_ORIGIN__", EVIL).replaceAll("__APP_ORIGIN__", APP).replaceAll("__XDR__", encodeURIComponent(xdr)).replaceAll("__PROVIDER_TAG__", providerTag);
const page = (name, opts) => fill(readFileSync(join(here, "pages", name), "utf8"), opts);
const routes = {
  [APP]: {
    "/app.html": () => ["text/html", page("app.html")],
    "/app-web.html": () => ["text/html", page("app.html", { providerTag: '<script src="/minigo.js"></script>' })],
    "/web-host.html": () => ["text/html", page("web-host.html")],
    "/web-host.js": () => ["text/javascript", readFileSync(webHost, "utf8")],
    "/minigo.js": () => ["text/javascript", provider],
  },
  [EVIL]: { "/evil.html": () => ["text/html", page("evil.html")] },
};
const servers = await Promise.all(
  Object.entries(routes).map(
    ([origin, table]) =>
      new Promise((resolve) => {
        const server = createServer((req, res) => {
          const route = table[new URL(req.url, origin).pathname];
          if (!route) return res.writeHead(404).end();
          const [type, body] = route();
          res.writeHead(200, { "Content-Type": type }).end(body);
        });
        server.listen(Number(new URL(origin).port), serveOnly ? "0.0.0.0" : undefined, () => resolve(server));
      }),
  ),
);

if (serveOnly) {
  console.log(`Serving.\n  Open in MiniGo (Profile > Developer): ${APP}/app.html\n  Its third-party frame comes from:       ${EVIL}/evil.html\nCtrl-C to stop.`);
  await new Promise(() => {});
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  args: ["--host-resolver-rules=MAP localhost 127.0.0.1"],
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } } : {}),
});

// gate "old" is the origin-only check MiniGo used to make, "new" is gateBridgeMessage.
// reportedUrl "top" is the top-level URL for every frame (Android fallback), "sender" the real frame's (iOS).
async function runNative({ gate, reportedUrl }) {
  const context = await browser.newContext();
  const nonce = randomBytes(24).toString("hex");
  const seen = [];
  const prompts = [];
  const walletContext = {
    network: TESTNET,
    address: async () => walletKey.publicKey(),
    keypair: async () => walletKey,
    isAllowed: async (origin) => origin === APP,
    allow: async () => {},
    // Note what the user would be asked, then decline.
    approve: async (request) => (prompts.push({ kind: request.kind, origin: request.origin }), false),
  };

  await context.exposeBinding("__bridge", async ({ frame, page }, data) => {
    const from = frame === page.mainFrame() ? "app" : "iframe";
    const senderUrl = reportedUrl === "top" ? page.mainFrame().url() : frame.url();
    let raw = null;
    if (gate === "old") raw = originOf(senderUrl) === APP ? data : null;
    else {
      const verdict = gateBridgeMessage(data, originOf(senderUrl), { nonce, appOrigin: APP });
      raw = verdict.ok ? verdict.raw : null;
    }
    let method = "?";
    try {
      method = JSON.parse(data).method;
    } catch {}
    seen.push({ from, method, accepted: raw !== null });
    if (raw === null) return;
    const response = await handleRequest(walletContext, APP, raw);
    if (response) await page.mainFrame().evaluate((r) => window.__minigoHostResponse(r), response).catch(() => {});
  });
  await context.addInitScript(
    ({ provider, nonce }) => {
      window.ReactNativeWebView = { postMessage: (data) => window.__bridge(String(data)) };
      // Like injectedJavaScriptBeforeContentLoadedForMainFrameOnly.
      if (window === window.top) {
        if (nonce) globalThis.__minigoNonce = nonce;
        (0, eval)(provider);
      }
    },
    { provider, nonce: gate === "new" ? nonce : "" },
  );

  const tab = await context.newPage();
  await tab.goto(`${APP}/app.html`);
  await tab.waitForFunction(() => window.__appDone === true, null, { timeout: 15000 });
  const evil = tab.frames().find((frame) => frame.url().startsWith(EVIL));
  await evil.waitForFunction(() => window.__evilDone === true, null, { timeout: 15000 });
  await tab.waitForTimeout(1000);

  const appOutput = JSON.parse(await tab.locator("#out").textContent());
  const attempts = await evil.evaluate(() => window.__attempts);
  await context.close();
  return { seen, prompts, appOutput, attempts };
}

console.log("Native WebView model (worst case: bridge visible in every frame)\n");
for (const { gate, reportedUrl } of [
  { gate: "old", reportedUrl: "top" },
  { gate: "old", reportedUrl: "sender" },
  { gate: "new", reportedUrl: "top" },
  { gate: "new", reportedUrl: "sender" },
]) {
  const { seen, prompts, appOutput, attempts } = await runNative({ gate, reportedUrl });
  const fromFrame = seen.filter((m) => m.from === "iframe");
  const acceptedFromFrame = fromFrame.filter((m) => m.accepted);
  const reproduced = gate === "old" && reportedUrl === "top";
  console.log(`${gate === "old" ? "OLD gate (origin string only)" : "NEW gate (nonce + origin)"}, platform reports ${reportedUrl === "top" ? "the top-level URL" : "the sender frame's URL"}`);

  check("the app's own main-frame requests work", appOutput.address === walletKey.publicKey() && appOutput.network === TESTNET.networkPassphrase);
  check("the iframe did reach the native bridge", fromFrame.length >= 6, `(${fromFrame.length} messages)`);
  if (reproduced) {
    check(
      "VULNERABILITY REPRODUCED: iframe requests were accepted as the trusted app",
      acceptedFromFrame.length > 0 && prompts.some((p) => p.origin === APP && p.kind !== "connect"),
      `(${acceptedFromFrame.length} accepted; approval prompts shown as "${APP}": ${prompts.map((p) => p.kind).join(", ")})`,
    );
  } else {
    check("no iframe request reached the wallet", acceptedFromFrame.length === 0 && prompts.length === 0, `(${acceptedFromFrame.length} accepted, ${prompts.length} prompts)`);
  }
  if (gate === "new") {
    const cross = Object.fromEntries(attempts.filter((a) => /^(parent|top)\./.test(a.name)).map((a) => [a.name, a.value]));
    check(
      "the frame could not read the nonce or the provider from the app's frame",
      Object.values(cross).every((value) => value.startsWith("blocked: ")),
      JSON.stringify(cross),
    );
  }
  console.log();
}

console.log("Web preview (mini app in an <iframe>; the browser reports the real sender)\n");
{
  const context = await browser.newContext();
  const tab = await context.newPage();
  await tab.goto(`${APP}/web-host.html`);
  const nested = async () => {
    const app = tab.frames().find((frame) => frame.url().startsWith(`${APP}/app-web.html`));
    return app?.childFrames().find((frame) => frame.url().startsWith(EVIL));
  };
  await tab.waitForFunction(() => document.getElementById("app") !== null);
  for (let i = 0; i < 50 && !(await nested()); i++) await tab.waitForTimeout(100);
  await (await nested()).waitForFunction(() => window.__evilDone === true, null, { timeout: 15000 });
  await tab.waitForTimeout(500);
  const { accepted, rejected } = await tab.evaluate(() => window.__web);
  check("the app's own requests are accepted", accepted.length > 0 && accepted.every((m) => m.origin === APP), JSON.stringify(accepted.map((m) => m.method)));
  check("the nested iframe's postMessage requests are rejected", rejected.some((m) => m.origin === EVIL) && !accepted.some((m) => m.origin === EVIL), `(${rejected.length} rejected)`);
  await context.close();
}

await browser.close();
servers.forEach((server) => server.close());
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
