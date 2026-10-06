# Submitting the MiniGo module to Stellar Wallets Kit

This is how MiniGo gets into `defaultModules()`, so it shows up in every dApp built on Stellar Wallets Kit without the dApp changing anything. **Nothing here has been submitted.**

The kit's own guide ([`docs/files/wallets/create-wallet-module.md`](https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/docs/files/wallets/create-wallet-module.md)) asks wallet developers to:

> After your module is done, open a PR with the module and we will review. Make sure to list if your module requires some extra dependency like for example a polyfill of Buffer.

The patch in [`upstream/`](upstream/) follows the same shape as the most recent wallets added: D'CENT (2.5.0), and MetaMask and GHOSTSIG (2.7.0).

## What's in the patch

`upstream/0001-feat-add-MiniGo-wallet-module.patch`, made against `main` at `7663331` (2026-09-25):

| File | Change |
| --- | --- |
| `src/sdk/modules/minigo.module.ts` | New `MiniGoModule` (`MINIGO_ID = "minigo"`) |
| `src/sdk/modules/minigo.module.test.ts` | 7 Deno tests: injection wait, missing provider, platform wrapper, access flow, error unwrapping, pass-through |
| `src/sdk/modules/utils.ts` | Added to `defaultModules()` and `sep43Modules()` |
| `src/deno.json` | Export `./modules/minigo` |
| `src/build_npm.ts` | npm entry point `./modules/minigo` |
| `docs/files/wallets/supported-wallets.md` | Table row |
| `CHANGELOG.md` | "Unreleased → Add" entry |

Checked against the kit, in its own tooling (Deno 2.9.6):

- `deno test sdk/modules/minigo.module.test.ts`: 7 passed
- `deno test sdk/modules/dcent.module.test.ts`: still passes
- `deno lint`, `deno fmt --check` on the changed files: clean
- `deno check mod.ts`: clean
- `deno publish --dry-run`: success (no slow types)

The module needs **no extra dependencies or polyfills**. It talks only to `window.mini`.

## Before you submit

Maintainers review wallets they can install and try. Have these ready first:

- [ ] **Something public to test with:**
  - a released MiniGo app build (TestFlight or Play internal testing) whose in-app browser injects the provider, and/or
  - the extension published on the Chrome Web Store (unlisted is fine).
- [ ] **Real product URL:** `productUrl` is `https://minigo.app` in the patch. Change it if MiniGo's site lives elsewhere.
- [ ] **Final icon:** `productIcon` is an inline SVG of the MiniGo mark. Swap in the final logo, keeping it inline like D'CENT's so the kit loads no external asset.
- [ ] **Mainnet support**, or a clear note that MiniGo is testnet-only for now. `getNetwork()` must report whichever network the wallet is really on.
- [ ] **Re-check against the latest `main`**, since the kit moves fast (2.7.0 shipped 2026-09-23). Rebase, re-run the checks below, and update the CHANGELOG heading if a release happened meanwhile.
- [ ] **Optionally publish our own copy first:** `dist/kit/minigo.module.js` as an npm package, so dApps can add MiniGo before the PR is merged.

## Steps

1. **Fork** `Creit-Tech/Stellar-Wallets-Kit` on GitHub, then clone your fork:

   ```bash
   git clone https://github.com/<you>/Stellar-Wallets-Kit && cd Stellar-Wallets-Kit
   git checkout -b add-minigo-module
   ```

2. **Apply the patch** from this folder:

   ```bash
   git am /path/to/minigo/minigo-wallet-sdk/upstream/0001-feat-add-MiniGo-wallet-module.patch
   ```

   If `main` has moved and it doesn't apply cleanly, copy `upstream/minigo.module.ts` and `upstream/minigo.module.test.ts` into `src/sdk/modules/`. Then make the five small edits listed in the table by hand.

3. **Run the kit's checks** (Deno 2.x):

   ```bash
   cd src
   deno test sdk/modules/minigo.module.test.ts
   deno lint sdk/modules/minigo.module.ts sdk/modules/minigo.module.test.ts sdk/modules/utils.ts
   deno fmt --check sdk/modules/minigo.module.ts sdk/modules/minigo.module.test.ts sdk/modules/utils.ts build_npm.ts
   deno check mod.ts
   deno publish --dry-run --allow-dirty
   ```

4. **Try it end to end:** from this folder, `npm test` runs the module inside Wallets Kit against the real extension. That covers connect, `signTransaction`, `signAuthEntry`, `signMessage` (all signatures verified), `getNetwork`, reject, and a live testnet payment.

5. **Push to your fork** and open a pull request against `Creit-Tech/Stellar-Wallets-Kit:main` with the description below.

6. **Follow up:** answer review comments on the PR. If they ask for changes, make them in `minigo-wallet-sdk/src/kit/minigo.module.ts` as well, so the npm copy and the upstream copy stay the same.

## Pull request description (draft)

```markdown
## Add MiniGo wallet module

MiniGo is a Stellar wallet with a mobile app (with an in-app browser for mini apps / dApps) and a browser extension.
Both inject a SEP-43 provider and a detection sentinel before page scripts run:

- `window.mini`: `getAddress`, `signTransaction`, `signAuthEntry`, `signMessage` (SEP-53), `getNetwork`,
  plus `requestAccess` / `isConnected`. Like D'CENT's provider it never throws; methods resolve with `{ ..., error? }`
  using SEP-43 error codes (-1 to -4).
- `window.stellar = { provider: "minigo", platform: "mobile" | "extension", version }`, frozen.
- A `minigo#initialized` event once the provider is installed.

The module:
- talks to `window.mini` directly (no `@stellar/freighter-api`), so it always targets MiniGo;
- waits up to 600 ms for `minigo#initialized` in `isAvailable()` (inside the 1000 ms budget);
- unwraps `{ error }` into rejections via `parseError`;
- returns `isPlatformWrapper() === true` inside MiniGo's own in-app browser.

No extra dependencies or polyfills. Added to `defaultModules()` and `sep43Modules()`.

### Testing
- `deno test sdk/modules/minigo.module.test.ts`: 7 tests (injection race, absent provider, platform wrapper,
  access flow, error unwrapping, pass-through).
- `deno lint`, `deno fmt --check`, `deno check mod.ts`, `deno publish --dry-run`: clean.
- End-to-end against the MiniGo extension in Chromium with this module inside the kit: connect, signTransaction,
  signAuthEntry, signMessage (signatures verified), getNetwork, user rejection (-4), wrong network (-3).

### How to try it
<link to the extension / app build>
```

## After it's merged

- Bump the kit version in any MiniGo dApps and examples, and drop the locally registered copy of the module.
- Keep the Freighter fallback on inside the MiniGo app, where no real Freighter can exist, for dApps that haven't upgraded to a kit version with MiniGo.
