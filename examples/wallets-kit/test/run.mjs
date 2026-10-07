// Runs the built page in Chromium with the MiniGo extension and answers its approval windows.
// Needs `npm run build` in the SDK first. Set CHROMIUM_PATH to use your own Chromium.
import { createReadStream, existsSync, mkdtempSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, "../dist");
const EXT = join(here, "../../../dist/extension");
const TESTNET = "Test SDF Network ; September 2015";
const ORIGIN = "http://127.0.0.1:5711";
for (const [dir, hint] of [[DIST, "npm run build"], [EXT, "npm run build in the SDK"]]) {
  if (!existsSync(dir)) throw new Error(`${dir} is missing. Run ${hint} first.`);
}

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`);
};

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  let file = join(DIST, decodeURIComponent(new URL(req.url, ORIGIN).pathname));
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(5711, "127.0.0.1", resolve));

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "minigo-example-")), {
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  ...(proxy ? { proxy, ignoreHTTPSErrors: true } : {}),
  args: [...(proxy ? ["--ignore-certificate-errors"] : []), `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--headless=new"],
});

// Approve each window unless a step queued "reject".
const decisions = [];
const approved = [];
ctx.on("page", async (page) => {
  await page.waitForLoadState().catch(() => {});
  if (!page.url().includes("/approve.html")) return;
  await page.waitForSelector("#origin:not(:empty)").catch(() => {});
  const reject = decisions.shift() === "reject";
  approved.push(reject ? "rejected" : "approved");
  await page.click(reject ? "#reject" : "#ok").catch(() => {});
});

const settle = (page, run, ...args) =>
  page.evaluate(
    async ([code, ...a]) => {
      try {
        return { ok: true, value: await new Function("example", "args", `return (${code})(example, ...args)`)(window.example, a) };
      } catch (error) {
        return { ok: false, code: error?.code, message: error?.message ?? String(error) };
      }
    },
    [run.toString(), ...args],
  );

try {
  const [worker] = ctx.serviceWorkers().length ? ctx.serviceWorkers() : [await ctx.waitForEvent("serviceworker")];
  const extPage = await ctx.newPage();
  await extPage.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await extPage.waitForTimeout(500);

  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector("body[data-ready=true]", { timeout: 30000 });

  console.log("Stellar Wallets Kit v2 with MiniGoModule");
  const wallets = await settle(page, (e) => e.wallets());
  check("MiniGo is a listed, available wallet", wallets.value.find((w) => w.id === "minigo")?.isAvailable, true);

  const early = await settle(page, (e) => e.getAddress());
  check("getAddress before connecting rejects", early.ok, false);

  const connected = await settle(page, (e) => e.connect());
  check("connect returns an address", /^G[A-Z2-7]{55}$/.test(connected.value?.address ?? ""), true);
  const address = connected.value?.address;
  check("connect asked the user once", approved, ["approved"]);
  check("getAddress returns the connected address", (await settle(page, (e) => e.getAddress())).value?.address, address);

  const network = await settle(page, (e) => e.getNetwork());
  check("getNetwork is testnet", network.value?.networkPassphrase, TESTNET);

  console.log("\nA valid testnet transaction");
  const funded = await settle(page, (e, a) => e.fundWithFriendbot(a), address);
  let online = funded.ok;
  if (!online) console.log(`  Friendbot unreachable (${funded.message}); signing an offline transaction and skipping submission`);
  const signedTx = await settle(
    page,
    async (e, a, sequence) => {
      const tx = await e.buildTransaction(a, undefined, sequence);
      const { signedTxXdr, signerAddress } = await e.signTransaction(a, tx);
      return { signedTxXdr, signerAddress, signed: e.isSignedBy(signedTxXdr, a), sequence: tx.sequence };
    },
    address,
    online ? undefined : "1",
  );
  if (!signedTx.ok) console.log("  signTransaction:", JSON.stringify(signedTx));
  check("signTransaction: signed by the wallet's key", signedTx.value?.signed, true);
  check("signTransaction: signer address", signedTx.value?.signerAddress, address);
  if (online) {
    const submitted = await settle(page, (e, xdr) => e.submit(xdr), signedTx.value.signedTxXdr);
    if (!submitted.ok) console.log("  submit:", JSON.stringify(submitted));
    check("the network accepted it (valid sequence, fee, signature)", /^[0-9a-f]{64}$/.test(submitted.value?.hash ?? ""), true);
  }

  console.log("\nSoroban authorization and messages");
  const auth = await settle(
    page,
    async (e, a) => {
      const preimage = e.authEntryPreimage();
      const { signedAuthEntry } = await e.signAuthEntry(a, preimage);
      return e.isAuthEntrySignedBy(preimage, signedAuthEntry, a);
    },
    address,
  );
  check("signAuthEntry: valid signature over the preimage hash", auth.value, true);
  const message = await settle(
    page,
    async (e, a) => {
      const text = "Sign in to example.com at 2026-09-29T12:00:00Z";
      const { signedMessage } = await e.signMessage(a, text);
      return e.isMessageSignedBy(text, signedMessage, a);
    },
    address,
  );
  check("signMessage: valid SEP-53 signature", message.value, true);

  console.log("\nRefusals");
  const promptsBefore = approved.length;
  const wrongNetwork = await settle(
    page,
    async (e, a) => e.signTransaction(a, await e.buildTransaction(a, undefined, "1"), "Public Global Stellar Network ; September 2015"),
    address,
  );
  check("a request for another network is refused with -3, before any prompt", [wrongNetwork.code, approved.length - promptsBefore], [-3, 0]);
  decisions.push("reject");
  const rejected = await settle(
    page,
    async (e, a) => e.signTransaction(a, await e.buildTransaction(a, undefined, "1")),
    address,
  );
  check("a declined request rejects with -4", rejected.code, -4);

  console.log("\nDisconnect");
  await settle(page, (e) => e.disconnect());
  const after = await settle(page, (e) => e.getAddress());
  check("getAddress rejects after disconnect", after.ok, false);
  const before = approved.length;
  const again = await settle(page, (e) => e.connect());
  check("connecting again works without a new prompt (MiniGo remembers the site)", [again.value?.address === address, approved.length === before], [true, true]);
} finally {
  await ctx.close();
  server.close();
}
console.log(`\n${failures ? `${failures} check(s) failed` : "All checks passed"}.`);
process.exitCode = failures ? 1 : 0;
