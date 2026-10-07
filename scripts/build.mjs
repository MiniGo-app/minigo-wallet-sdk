// Builds dist/extension (load it unpacked), dist/inpage.embedded.js (the provider MiniGo injects into mini apps)
// and dist/kit (the Wallets Kit module). Then copies the provider into examples/mini-app and, when the app is
// checked out next to this repo, into ../minigo.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const ext = join(dist, "extension");
rmSync(dist, { recursive: true, force: true });
mkdirSync(ext, { recursive: true });

const common = { bundle: true, target: "es2020", legalComments: "none", logLevel: "warning" };

// No Stellar SDK in the in-page providers, so they stay small.
for (const [file, compat] of [["inpage.js", false], ["inpage.freighter.js", true]]) {
  await build({ ...common, entryPoints: [join(root, "src/inpage/extension.ts")], outfile: join(ext, file), format: "iife", minify: true, define: { __FREIGHTER_COMPAT__: String(compat) } });
}
await build({ ...common, entryPoints: [join(root, "src/inpage/embedded.ts")], outfile: join(dist, "inpage.embedded.js"), format: "iife", minify: true });

// Extension pages and worker.
for (const name of ["background", "relay", "popup", "approve"]) {
  await build({ ...common, entryPoints: [join(root, `extension/src/${name}.ts`)], outfile: join(ext, `${name}.js`), format: "iife", platform: "browser" });
}
for (const file of ["manifest.json", "popup.html", "approve.html", "style.css"]) cpSync(join(root, "extension", file), join(ext, file));

// Wallets Kit module for dApps that install it from npm.
await build({ ...common, entryPoints: [join(root, "src/kit/minigo.module.ts")], outfile: join(dist, "kit/minigo.module.js"), format: "esm", external: ["@creit.tech/stellar-wallets-kit"] });

const embedded = readFileSync(join(dist, "inpage.embedded.js"), "utf8").trim();
writeFileSync(
  join(root, "examples/mini-app/public/minigo.js"),
  `/* MiniGo in-page provider, built by minigo-wallet-sdk. Inside the MiniGo app it is injected already and this does nothing. */\n${embedded}\n`,
);
const app = join(root, "../minigo/src/mini");
if (existsSync(app)) {
  writeFileSync(
    join(app, "inpage.generated.ts"),
    `// Built by minigo-wallet-sdk (npm run build). Don't edit this file, change src/inpage there instead.\n` +
      `export const inpageProvider = ${JSON.stringify(embedded + "\ntrue;")};\n`,
  );
}

const size = (file) => `${(readFileSync(file).length / 1024).toFixed(1)} kB`;
console.log(`built: extension (inpage ${size(join(ext, "inpage.js"))}, background ${size(join(ext, "background.js"))}), embedded provider ${size(join(dist, "inpage.embedded.js"))}, kit module`);
