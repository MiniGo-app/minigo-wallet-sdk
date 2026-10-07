# Getting MiniGo into Stellar Wallets Kit

Once the module is in the kit's `defaultModules()`, every dApp built on Stellar Wallets Kit lists MiniGo without changing anything. Nothing here has been submitted yet.

The kit's [guide for wallet modules](https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/docs/files/wallets/create-wallet-module.md) asks for a PR with the module and a note on any extra dependency. The patch follows the shape of the most recent wallets added: D'CENT in 2.5.0 and MetaMask and GHOSTSIG in 2.7.0.

## The patch

`0001-feat-add-MiniGo-wallet-module.patch` is made against the kit's `main` at `7663331` (2026-09-25):

| File | Change |
| --- | --- |
| `src/sdk/modules/minigo.module.ts` | New `MiniGoModule` (`MINIGO_ID = "minigo"`) |
| `src/sdk/modules/minigo.module.test.ts` | 7 Deno tests |
| `src/sdk/modules/utils.ts` | Added to `defaultModules()` and `sep43Modules()` |
| `src/deno.json` | Exports `./modules/minigo` |
| `src/build_npm.ts` | npm entry point `./modules/minigo` |
| `docs/files/wallets/supported-wallets.md` | Table row |
| `CHANGELOG.md` | Unreleased entry |

It passes the kit's own checks with Deno 2.9.6: the tests, `deno lint`, `deno fmt --check`, `deno check mod.ts` and `deno publish --dry-run`. The module has no dependencies and needs no polyfills.

`minigo.module.ts` here is the same as `src/kit/minigo.module.ts` apart from the imports. Keep the two in step.

## Before submitting

Maintainers review wallets they can install and try, so first:

- [ ] Publish something to test with: a TestFlight or Play internal build of the app, or the extension on the Chrome Web Store (unlisted is fine).
- [ ] Check `productUrl` (`https://minigo.app` in the patch).
- [ ] Swap in the final logo for `productIcon`, inline like D'CENT's.
- [ ] Support mainnet, or say clearly that MiniGo is testnet only for now.
- [ ] Rebase on the latest `main`, rerun the checks and fix the CHANGELOG heading if a release went out.
- [ ] Optionally publish `dist/kit/minigo.module.js` to npm so dApps can add MiniGo before the PR is merged.

## Submitting

1. Fork `Creit-Tech/Stellar-Wallets-Kit` and clone the fork:

   ```bash
   git clone https://github.com/<you>/Stellar-Wallets-Kit && cd Stellar-Wallets-Kit
   git checkout -b add-minigo-module
   ```

2. Apply the patch:

   ```bash
   git am /path/to/minigo-wallet-sdk/upstream/0001-feat-add-MiniGo-wallet-module.patch
   ```

   If it no longer applies, copy `minigo.module.ts` and `minigo.module.test.ts` into `src/sdk/modules/` and make the other edits in the table by hand.

3. Run the kit's checks from `src/`:

   ```bash
   deno test sdk/modules/minigo.module.test.ts
   deno lint sdk/modules/minigo.module.ts sdk/modules/minigo.module.test.ts sdk/modules/utils.ts
   deno fmt --check sdk/modules/minigo.module.ts sdk/modules/minigo.module.test.ts sdk/modules/utils.ts build_npm.ts
   deno check mod.ts
   deno publish --dry-run --allow-dirty
   ```

4. Run `npm test` in this repo. It drives the module inside the kit against the real extension: connect, every signing call with the signatures checked, `getNetwork`, a rejection and a testnet payment.

5. Push to the fork and open a PR against `Creit-Tech/Stellar-Wallets-Kit:main` with the description below.

6. If review asks for changes, make them in `src/kit/minigo.module.ts` too.

## PR description (draft)

```markdown
## Add MiniGo wallet module

MiniGo is a Stellar wallet with a mobile app (which runs dApps in an in-app browser) and a browser extension.
Both inject a SEP-43 provider before page scripts run:

- `window.mini`: `getAddress`, `signTransaction`, `signAuthEntry`, `signMessage` (SEP-53) and `getNetwork`,
  plus `requestAccess` and `isConnected`. Like D'CENT's provider it never throws. Methods resolve with
  `{ ..., error? }` using the SEP-43 error codes.
- `window.stellar = { provider: "minigo", platform: "mobile" | "extension", version }`, frozen.
- A `minigo#initialized` event once the provider is installed.

The module talks to `window.mini` directly, so it always targets MiniGo. It waits up to 600 ms for
`minigo#initialized` in `isAvailable()`, turns `{ error }` results into rejections with `parseError` and reports
itself as the platform wrapper inside the MiniGo app.

No extra dependencies or polyfills. Added to `defaultModules()` and `sep43Modules()`.

### Testing

- `deno test sdk/modules/minigo.module.test.ts`: 7 tests.
- `deno lint`, `deno fmt --check`, `deno check mod.ts` and `deno publish --dry-run` are clean.
- End to end against the MiniGo extension in Chromium: connect, signTransaction, signAuthEntry, signMessage
  (signatures verified), getNetwork, a user rejection (-4) and a wrong network (-3).

### How to try it

<link to the extension or app build>
```

## After it's merged

Bump the kit in the examples and drop the locally registered module. Keep the Freighter fallback on in the app for dApps still on an older kit.
