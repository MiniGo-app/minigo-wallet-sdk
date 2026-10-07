# Wallets Kit example

A small testnet dApp that connects to MiniGo through Stellar Wallets Kit v2 and makes every wallet call.

| Step | Call | Notes |
| --- | --- | --- |
| Connect | `init({ modules: [...defaultModules(), new MiniGoModule()] })`, `setWallet("minigo")`, `fetchAddress()` | MiniGo asks the user the first time |
| getAddress | `getAddress()` | Rejects before connecting and after disconnecting |
| getNetwork | `getNetwork()` | Testnet |
| signTransaction | `signTransaction(xdr, { networkPassphrase, address })` | Built with the account's real sequence number, so testnet accepts it |
| signAuthEntry | `signAuthEntry(preimageXdr, ...)` | A Soroban `transfer` authorization |
| signMessage | `signMessage(text, ...)` | SEP-53, verified in the page |
| disconnect | `disconnect()` | MiniGo still remembers the site until you remove it under Connected apps |

The wallet calls are in `src/flow.ts` and the buttons in `src/main.ts`.

## Run it

```bash
(cd ../.. && npm install && npm run build)
npm install
npm run dev        # http://localhost:5175
```

Open it in a browser with the extension loaded from `dist/extension` in the SDK, or in the MiniGo app under Profile > Developer using your machine's network address. Press Connect, then Fund with Friendbot, then the sign buttons.

## Test it

```bash
npm test
```

This loads the extension into Chromium, answers its approval windows and checks every call through the kit, including that testnet accepts the signed transaction, that a wrong network is refused with `-3` before any prompt and that a decline rejects with `-4`. If Friendbot is down it signs an offline transaction and skips the submission.
