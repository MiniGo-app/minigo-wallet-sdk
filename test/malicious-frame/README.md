# Malicious iframe test

Can an iframe inside an approved mini app use MiniGo's wallet bridge and pass for the app?

With the old check it could, on any platform that reports the top-level URL for messages from every frame, which is what react-native-webview's Android fallback does. The app now requires a secret nonce that only the main frame has, and this test shows the frame being refused.

- `pages/app.html` is a trusted mini app that embeds a frame from another origin.
- `pages/evil.html` is that frame. It posts every wallet request to the native bridge, guesses the nonce, tries to read the nonce and the provider from the app's frame and posts to the hosting window.
- `run.mjs` models the WebView in Chromium with the weakest assumptions: the bridge exists in every frame, the provider and nonce only in the main frame and the reported sender URL is either the top-level one (Android fallback) or the frame's own (iOS). Each case runs against the old origin check and the new gate. The web preview is checked with its `event.source` rule.

## Run it

From the SDK folder:

```bash
npm run build
npm run test:frame
```

The old check with the top-level URL should show `VULNERABILITY REPRODUCED`. Every other case should show no frame request reaching the wallet, and the app's own requests should work in all of them.

## Limits

This is not a test on a phone. It relies on what react-native-webview 13.16.1's source says about which frames get injected scripts and which URL comes with a message. Before shipping, run `node --experimental-strip-types run.mjs --serve <your network address>`, open the printed URL in MiniGo on an iOS and an Android device and check that the frame's attempts never cause an approval sheet.

A frame on the same origin as the app is the same principal and can reach the app's `window.mini` through `parent`. That is expected.
