// End-to-end: the built extension in Chromium, against Stellar Wallets Kit 2.x and @stellar/freighter-api,
// plus a real testnet payment. Run `npm run build` first (npm test does).
// Uses CHROMIUM_PATH if set, otherwise Playwright's Chromium (`npx playwright-core install chromium`).
import { execSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-base";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const EXT = join(root, "dist/extension");
const TESTNET = "Test SDF Network ; September 2015";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}: ${JSON.stringify(actual)}${ok ? "" : `  (expected ${JSON.stringify(expected)})`}`);
}

function serve(dir, port) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const server = createServer((req, res) => {
    let file = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

console.log("Building test page…");
execSync("npx vite build -c test/e2e/page/vite.config.mjs", { cwd: root, stdio: "inherit" });
const servers = [await serve(join(here, ".build/page"), 5701), await serve(join(here, "race"), 5702)];
// A page the browser runs with an opaque ("null") origin, like every other sandboxed page and data: URL.
servers.push(
  await new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "sandbox allow-scripts" });
      res.end(`<!doctype html><pre id="out">waiting</pre><script>
        addEventListener("load", async () => {
          const out = document.getElementById("out");
          try {
            if (!window.mini) { out.textContent = JSON.stringify({ provider: false }); return; }
            const r = await window.mini.requestAccess();
            out.textContent = JSON.stringify({ provider: true, code: r.error && r.error.code, address: r.address });
          } catch (e) { out.textContent = JSON.stringify({ provider: true, threw: String(e) }); }
        });
      </script>`);
    });
    server.listen(5703, "127.0.0.1", () => resolve(server));
  }),
);

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "minigo-ext-")), {
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  // Sandboxed CI/dev environments that only reach the internet through a proxy.
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" }, ignoreHTTPSErrors: true } : {}),
  args: [...(process.env.HTTPS_PROXY ? ["--ignore-certificate-errors"] : []), `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--headless=new"],
});

// Approval windows: approve unless a test queued "reject".
const decisions = [];
let approvals = 0;
ctx.on("page", async (page) => {
  await page.waitForLoadState().catch(() => {});
  if (!page.url().includes("/approve.html")) return;
  approvals++;
  await page.waitForSelector("#origin:not(:empty)").catch(() => {});
  await page.click(decisions.shift() === "reject" ? "#reject" : "#ok").catch(() => {});
});

try {
  const [worker] = ctx.serviceWorkers().length ? ctx.serviceWorkers() : [await ctx.waitForEvent("serviceworker")];
  const extId = new URL(worker.url()).host;
  worker.on("console", (m) => m.type() === "error" && console.log("  · extension worker:", m.text()));
  const extPage = await ctx.newPage();
  await extPage.goto(`chrome-extension://${extId}/popup.html`);
  const extMessage = (message) => extPage.evaluate((m) => chrome.runtime.sendMessage(m), message);
  await extPage.waitForTimeout(500); // onInstalled registers the main-world provider

  const open = async (url) => {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById("out")?.textContent === "ready", null, { timeout: 30000 }).catch(() => {});
    return page;
  };

  console.log("\n1. Provider is in place before the page's first script (10 loads)");
  let early = 0;
  for (let i = 0; i < 10; i++) {
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:5702/?${i}`);
    const r = await page.evaluate(() => window.__early);
    if (r.mini && r.sentinel === "minigo") early++;
    await page.close();
  }
  check("window.mini + window.stellar sentinel before page scripts", early, 10);

  console.log("\n2. Stellar Wallets Kit 2.7.0 + MiniGoModule (Freighter fallback off)");
  let page = await open("http://127.0.0.1:5701/");
  const wallets = await page.evaluate(() => window.listWallets());
  check("MiniGo listed and available", wallets.find((w) => w.id === "minigo")?.isAvailable, true);
  check("Freighter not claimed while the fallback is off", wallets.find((w) => w.id === "freighter")?.isAvailable, false);
  const kit = await page.evaluate(() => window.kitFlow("minigo"));
  check("connect (approval window)", kit.connected, true);
  check("getNetwork passphrase", kit.networkPassphrase, TESTNET);
  check("signTransaction: valid signature by the wallet key", kit.signTransaction, true);
  check("signAuthEntry: valid signature over the preimage hash", kit.signAuthEntry, true);
  check("signMessage: valid SEP-53 signature", kit.signMessage, true);
  check("mainnet request refused with -3", kit.wrongNetworkRejected, -3);
  decisions.push("reject");
  check("user reject returns -4", (await page.evaluate(() => window.rejectFlow())).rejectedCode, -4);
  await page.close();

  console.log("\n3. Freighter fallback on: official @stellar/freighter-api and the kit's Freighter module");
  await extMessage({ kind: "set-freighter-compat", value: true });
  await extMessage({ kind: "forget-site", origin: "http://127.0.0.1:5701" });
  page = await open("http://127.0.0.1:5701/");
  const f = await page.evaluate(() => window.freighterFlow());
  check("isConnected", f.isConnected, true);
  check("isAllowed before connecting", f.isAllowedBefore, false);
  check("getAddress before connecting is empty", f.getAddressBefore, "");
  check("requestAccess", f.requestAccess, true);
  check("isAllowed after", f.isAllowedAfter, true);
  check("getAddress after", f.getAddressAfter, true);
  check("setAllowed", f.setAllowed, true);
  check("getNetworkDetails", f.networkDetails, { network: "TESTNET", passphrase: TESTNET, url: "https://horizon-testnet.stellar.org", rpc: "https://soroban-testnet.stellar.org" });
  check("signTransaction", f.signTransaction, true);
  check("signAuthEntry", f.signAuthEntry, true);
  check("signMessage", f.signMessage, true);
  check("addToken answers with a -3 error (not a silent empty result)", f.addTokenErrorCode, -3);
  check("WatchWalletChanges", f.watch, true);
  const viaFreighter = await page.evaluate(() => window.kitFlow("freighter"));
  check("kit Freighter module: signTransaction", viaFreighter.signTransaction, true);
  check("kit Freighter module: signAuthEntry", viaFreighter.signAuthEntry, true);
  check("kit Freighter module: signMessage", viaFreighter.signMessage, true);

  console.log("\n4. A page with an opaque origin (CSP sandbox) is refused, not hung");
  {
    const before = approvals;
    const sandboxed = await ctx.newPage();
    await sandboxed.goto("http://127.0.0.1:5703/");
    await sandboxed.waitForFunction(() => document.getElementById("out")?.textContent !== "waiting", null, { timeout: 15000 }).catch(() => {});
    const text = (await sandboxed.textContent("#out")) || "";
    const result = text.startsWith("{") ? JSON.parse(text) : {};
    check("sandboxed page: refused with -3", result.code, -3);
    check("sandboxed page: no address, no approval window", [result.address || "", approvals - before], ["", 0]);
    await sandboxed.close();
  }

  console.log("\n5. A real testnet payment through window.mini.requestPayment");
  const { address } = await extMessage({ kind: "wallet-state" });
  const funded = await fetch(`https://friendbot.stellar.org/?addr=${address}`).then((r) => r.ok).catch(() => false);
  if (!funded) {
    console.log("  · friendbot unreachable — skipping the network test");
  } else {
    const recipient = Keypair.random().publicKey();
    const paid = await page.evaluate((to) => window.payFlow(to), recipient);
    if (!paid.hash) console.log("  · payment response:", JSON.stringify(paid));
    check("payment returns a hash", /^[0-9a-f]{64}$/.test(paid.hash ?? ""), true);
    const onChain = await fetch(`https://horizon-testnet.stellar.org/transactions/${paid.hash}`).then((r) => r.json());
    check("Horizon: transaction successful", onChain.successful, true);
    check("Horizon: memo", onChain.memo, "e2e test");
    const created = await fetch(`https://horizon-testnet.stellar.org/accounts/${recipient}`).then((r) => r.json());
    check("Horizon: recipient account created with 2 XLM", created.balances?.find((b) => b.asset_type === "native")?.balance, "2.0000000");
  }
  console.log(`\n  (${approvals} approval windows answered)`);
} finally {
  await ctx.close();
  servers.forEach((s) => s.close());
}
console.log(`\n${failures ? `${failures} check(s) failed` : "All checks passed"}.`);
process.exitCode = failures ? 1 : 0;
