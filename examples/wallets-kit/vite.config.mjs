export default {
  build: { outDir: "dist", emptyOutDir: true },
  // The SDK is linked from ../.., so make it use this app's copy of the kit.
  resolve: { dedupe: ["@creit.tech/stellar-wallets-kit", "@stellar/stellar-base"] },
  server: { port: 5175 },
};
