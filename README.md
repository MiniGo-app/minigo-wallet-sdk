# MiniGo wallet SDK

How Stellar dApps talk to MiniGo, in the MiniGo app and in the browser extension.

| Piece | What it is | Where |
| --- | --- | --- |
| SEP-43 provider | `window.mini` with `getAddress`, `signTransaction`, `signAuthEntry`, `signMessage` and `getNetwork`, plus `requestAccess`, `isAllowed` and MiniGo's `requestPayment` | `src/inpage/provider.ts` |
| Freighter fallback | Answers `@stellar/freighter-api` messages so Freighter-only dApps work | `src/inpage/freighter.ts` |
| Wallet host | Validates each request, asks the user, signs and submits. Used by the extension and the app | `src/host.ts`, `src/core/` |
| Bridge gate | Makes sure a request in the app came from the mini app's main frame and not an iframe inside it | `src/bridge-gate.ts` |
| Wallets Kit module | `MiniGoModule` for Stellar Wallets Kit 2.x | `src/kit/minigo.module.ts` |
| Browser extension | Manifest V3, testnet only | `extension/` |
| Upstream proposal | The module as a patch for the kit, not submitted yet | `upstream/` |
| Examples | A Wallets Kit dApp and a plain mini app | `examples/` |

## How it fits together

A dApp calls `window.mini` (directly or through the kit's `MiniGoModule`) or the Freighter API. The provider is installed before any page script runs and turns each call into a message:

- In the extension, `relay.js` passes it to `background.js`, which opens an approval window.
- In the MiniGo app, the WebView passes it to `MiniAppHost`, which shows an approval sheet and asks for the PIN.

Both end in `src/host.ts`, which checks permission, validates the request and signs.

Nothing is signed silently. A site has to be connected first and every signature and payment is shown to the user. Requests for the wrong network or a different signer are refused with `-3` before the user is asked, and a decline returns `-4`. Each site can have at most 3 prompts waiting.

The Freighter fallback is always on inside the app, where no real Freighter exists. In the extension it is off unless the user turns on "Answer as Freighter" in the popup, since the real Freighter may be installed.

## Use it in a dApp

Until the kit ships the module, register it yourself:

```ts
import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { MiniGoModule } from "minigo-wallet-sdk/kit";

StellarWalletsKit.init({ modules: [...defaultModules(), new MiniGoModule()], network: Networks.TESTNET });
```

Or call `window.mini` directly:

```js
const { address, error } = await window.mini.getAddress();
const { signedTxXdr } = await window.mini.signTransaction(xdr, { networkPassphrase });
const { hash } = await window.mini.requestPayment({ to, amount: "5", asset: "XLM", memo: "Order 42" });
```

`asset` is `"XLM"` (the default), `"USDC"` or `"CODE:ISSUER"`. XLM sent to an address with no account creates it, which needs at least 1 XLM.

## Build and test

```bash
npm install
npm run build        # dist/extension, dist/inpage.embedded.js and dist/kit
npm test             # build, unit tests, extension end to end, iframe test
```

The build also copies the provider into `examples/mini-app/public/minigo.js` and, if the app repo is checked out next to this one as `minigo`, into `minigo/src/mini/inpage.generated.ts`.

To try the extension, open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and pick `dist/extension`. It creates a testnet key on first run and keeps it in `chrome.storage.local`, which is not how a key for real funds should be stored.

The tests:

- `test/unit`: SEP-53 vectors, signatures, refusals, the host's approval rules and the bridge gate.
- `test/e2e`: the built extension in Chromium against Stellar Wallets Kit 2.7.0 and `@stellar/freighter-api` 6.0.1, including a real testnet payment.
- `test/malicious-frame`: an iframe inside an approved mini app trying to use the wallet. See its README.

Set `CHROMIUM_PATH` to use your own Chromium and `HTTPS_PROXY` if you're behind a proxy.

## Protocol

Messages are JSON (`src/protocol.ts`):

- Request: `{ source: "minigo-inpage", id, method, params }`
- Response: `{ source: "minigo-host", type: "response", id, result | error }`

The extension uses `window.postMessage`. The app uses `ReactNativeWebView.postMessage` and answers through `window.__minigoHostResponse(...)`. The app's web preview uses `parent.postMessage`.

The host takes the origin from the browser or WebView, never from the message. Inside the app a WebView delivers messages from iframes through the same channel, so the provider is injected into the main frame only along with a secret nonce, and `src/bridge-gate.ts` drops any request without it.
