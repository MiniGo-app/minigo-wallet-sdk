# MiniGo wallet SDK

The standard way for Stellar dApps to reach MiniGo, plus the Freighter imitation kept as a fallback:

| Piece | What it is | Where |
| --- | --- | --- |
| **SEP-43 provider** | `window.mini` with `getAddress`, `signTransaction`, `signAuthEntry`, `signMessage`, `getNetwork` (plus `requestAccess`, `isAllowed`, and MiniGo's `requestPayment`), a `window.stellar` sentinel and a `minigo#initialized` event | `src/inpage/provider.ts` |
| **Freighter fallback** | Answers `@stellar/freighter-api` messages, so Freighter-only dApps and the kit's default Freighter module work | `src/inpage/freighter.ts` |
| **Wallet host** | Validates every page request, asks the user, signs, submits. Shared by the extension and the MiniGo app | `src/host.ts`, `src/core/` |
| **Wallets Kit module** | `MiniGoModule` for Stellar Wallets Kit 2.x | `src/kit/minigo.module.ts` |
| **Browser extension** | Manifest V3, testnet, built on all of the above | `extension/` → `dist/extension/` |
| **Upstream proposal** | The module as a patch for the kit, with tests, ready to submit (not submitted) | `upstream/`, [SUBMISSION.md](SUBMISSION.md) |

## How the pieces fit

```
dApp page ──────────────┐
  Wallets Kit            │  window.mini (SEP-43)        ─┐
    MiniGoModule ────────┤                               │ minigo-inpage messages
    FreighterModule ─────┤  Freighter messages (fallback) ┤
  @stellar/freighter-api ┘                               │
                                                         ▼
                              extension: relay.js ─► background.js ─► approve window
                              MiniGo app: WebView ─► MiniAppHost ─► approval sheets + PIN
                                            └──── src/host.ts: permission, validation, signing, Horizon
```

- **Injection timing:** the provider is installed before any page script runs:
  - Extension: a main-world content script at `document_start`.
  - MiniGo: `injectedJavaScriptBeforeContentLoaded`.
  - A dApp's first script always sees `window.mini`; this was 0 of 10 page loads with the old extension, and is 10 of 10 now.
- **Where the Freighter fallback runs:**
  - MiniGo app: always on, since no real Freighter exists inside the app.
  - Extension: off by default, with a switch in the popup ("Answer as Freighter"), because the user may also have the real Freighter installed.
- **Nothing is signed silently:** every site must be connected first, and every signature and payment is shown to the user. Requests for the wrong network or a different signer are refused with `-3` before the user is asked; a user refusal returns `-4`.
- **Flaky networks:** Horizon calls retry through brief drops. Resending a signed transaction is safe (one hash, one sequence number), and a Horizon timeout is followed up by looking the transaction up.

## Use it in a dApp

Until the kit ships the module, register it yourself:

```ts
import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { MiniGoModule } from "minigo-wallet-sdk/kit"; // dist/kit/minigo.module.js

StellarWalletsKit.init({ modules: [...defaultModules(), new MiniGoModule()], network: Networks.TESTNET });
```

Or call `window.mini` directly:

```js
const { address, error } = await window.mini.getAddress();
const { signedTxXdr } = await window.mini.signTransaction(xdr, { networkPassphrase });
const { hash } = await window.mini.requestPayment({ to: "G…", amount: "5", asset: "XLM", memo: "Order 42" });
```

## Build, install, test

```bash
npm install
npm run build        # dist/extension, dist/inpage.embedded.js, dist/kit; also refreshes the MiniGo copy
npm test             # build + unit tests + end-to-end in Chromium
```

- **Load the extension:** open `chrome://extensions`, turn on Developer mode, click "Load unpacked", and pick `dist/extension`. On first run it creates a **testnet** key, kept in `chrome.storage.local`. That's fine for testnet, and not how keys for real funds should be stored.
- **Unit tests** (`test/unit`):
  - the three SEP-53 test vectors;
  - a transaction signature and an auth-entry signature, each verified;
  - refusals for the wrong network, the wrong signer, and malformed XDR;
  - the host: nothing is signed without approval, wrong-network and malformed requests are refused before the user is asked, a decline is `-4`, unconnected sites learn nothing.
- **Bridge gate** (`test/unit/bridge-gate.test.ts`): a request without the nonce, or with a wrong, guessed or wrongly typed one, is refused; the sender origin is still enforced for URL apps; the web check rejects a frame nested inside the app's frame.
- **Hermes check** (`test/hermes`, optional, needs a ~140 MB download): runs the app's Android bundle in the real Hermes engine and in Node and requires identical output. Browser and Node tests can't catch engine differences; see the MiniGo README ("Stellar on React Native").
- **End-to-end tests** (`test/e2e`), running the built extension in Chromium against Stellar Wallets Kit 2.7.0 and `@stellar/freighter-api` 6.0.1:
  - the provider is ready before page scripts;
  - `MiniGoModule` through the kit, with every signature verified;
  - every Freighter API function through the fallback, and the kit's Freighter module;
  - a real testnet payment, confirmed on Horizon.

  It uses `CHROMIUM_PATH` if set, and `HTTPS_PROXY` if the machine only reaches the internet through a proxy.

## Protocol

The page and the wallet exchange JSON messages (`src/protocol.ts`):

- **Request:** `{ source: "minigo-inpage", id, method, params }`
- **Response:** `{ source: "minigo-host", type: "response", id, result | error }`
- **Transport:**
  - Extension: `window.postMessage` to the relay content script.
  - MiniGo app: `ReactNativeWebView.postMessage` for requests; answers are evaluated as `window.__minigoHostResponse(...)`.
  - MiniGo web preview: `parent.postMessage` from the iframe.
- **Trust:** the host never trusts the page. It takes the origin from the browser or WebView, not from the message, and validates every parameter.
- **Who sent it (MiniGo app):** a WebView delivers messages from iframes inside the page through the same channel, and the URL that comes with a message is not a reliable sender identity on every platform. So the provider is injected into the main frame only, together with a secret nonce, and `src/bridge-gate.ts` accepts a request only if it carries that nonce. `test-malicious-frame/` at the repo root reproduces the old problem and tests the fix. In the web preview the browser's `event.source` is exact, and the same file holds that check.

`requestPayment` accepts `asset` as `"XLM"` (default), `"USDC"` (Circle's issuer for the network), or `"CODE:ISSUER"`. XLM sent to an address with no account creates it (minimum two base reserves, 1 XLM today; read from the ledger); other assets need the recipient's trustline.
