# Example mini app

A plain web page that uses MiniGo's `window.mini` on testnet, the way a partner's mini app would. Payments it asks for are real testnet transactions.

## Run it

```bash
npm start            # http://localhost:4173 and your network address
```

There are no dependencies. Set `PORT` to use another port.

With the app running from `npx expo start`, open it under Mini apps > Developer > Test Mini App, or enter any URL under Profile > Developer. The app finds your computer's address from Metro, so the phone and the computer need to be on the same Wi-Fi. Set `EXPO_PUBLIC_TEST_MINI_APP_URL` to point it somewhere else.

## What it does

Every call resolves with its result or with `{ error: { code, message } }`. `-3` means the request was invalid and `-4` that the user declined.

| Call | What MiniGo does |
| --- | --- |
| `requestAccess()` | Shows the connect sheet and resolves `{ address }` |
| `getAddress()` | Resolves `{ address }`, asking to connect first if needed |
| `getNetwork()` | Resolves `{ network: "TESTNET", networkPassphrase, ... }` |
| `requestPayment({ to, amount, asset, memo })` | Shows the payment sheet, asks for the PIN, submits on testnet and resolves `{ hash }` |
| `signMessage(message)` | Signs with SEP-53 after the PIN and resolves `{ signedMessage, signerAddress }` |

The Edge cases buttons send bad requests (a bad address, a zero amount, an unknown asset, the wrong network) and each should come back with an error rather than hang.

To pay you need test funds: tap Get 10,000 test XLM on Home or Receive. For USDC, add it under Profile > Manage assets and use [Circle's faucet](https://faucet.circle.com).

## In your own mini app

Inside the app `window.mini` is injected before your scripts run. Include `public/minigo.js` as well: it does nothing in the app and gives you the same API in MiniGo's web preview. It is built by `npm run build` in the SDK.
