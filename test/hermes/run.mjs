// Proves the wallet's Stellar code behaves the same on Hermes (React Native's engine) as on Node.
//
// Browser and Node tests can't catch engine differences: Hermes slices a Buffer into a plain Uint8Array, which
// once made every transaction the phone sent unreadable to Stellar. This builds the same script two ways, with the
// app's own Metro config for Android (so it uses the app's Buffer polyfill and module choices) and for Node, runs
// the first in Hermes and the second in Node, and requires identical output: transaction hashes, signed XDR,
// SEP-53 and auth-entry signatures, and parsed memos and assets.
//
//   npm install --no-save hermes-engine-cli    (in this folder; a ~140 MB download, Linux or macOS)
//   node test/hermes/run.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "../../../minigo");
const scratch = join(app, ".parity");
const hermesDir = join(here, "node_modules/hermes-engine-cli", process.platform === "darwin" ? "osx-bin" : "linux64-bin");
const hermes = process.env.HERMES_BIN || join(hermesDir, "hermes");
if (!existsSync(hermes)) {
  console.error("Hermes not found. Run `npm install --no-save hermes-engine-cli` in test/hermes, or set HERMES_BIN.");
  process.exit(2);
}

rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
try {
  cpSync(join(here, "entry.template.ts"), join(scratch, "entry.ts"));
  writeFileSync(join(scratch, "main.ts"), 'import "../src/polyfills";\nimport "./entry";\n');

  // 1. The Android bundle exactly as the app builds it.
  const build = `const Metro=require("metro");(async()=>{const c=await Metro.loadConfig({cwd:process.cwd()});c.reporter={update(){}};
    const {code}=await Metro.runBuild(c,{entry:".parity/main.ts",platform:"android",dev:false,minify:false});
    require("fs").writeFileSync(".parity/android.js",code);})().catch(e=>{console.error(e.message);process.exit(1)})`;
  execFileSync(process.execPath, ["-e", build], { cwd: app, stdio: "inherit", env: { ...process.env, EXPO_OFFLINE: "1" } });

  // 2. The same script for Node.
  await esbuild.build({
    entryPoints: [join(scratch, "entry.ts")], bundle: true, platform: "node", format: "iife", outfile: join(scratch, "node.js"),
    nodePaths: [join(app, "node_modules")], logLevel: "error",
  });

  const printAll = "run().then(function(o){o.forEach(function(l){print(l);});print('DONE');},function(e){print('ERR '+(e&&e.stack||e));});";
  writeFileSync(join(scratch, "hermes-full.js"), readFileSync(join(here, "prelude.js"), "utf8") + readFileSync(join(scratch, "android.js"), "utf8") + "\n" + printAll);
  const inHermes = spawnSync(hermes, [join(scratch, "hermes-full.js")], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout;
  writeFileSync(join(scratch, "node-full.js"), `${readFileSync(join(scratch, "node.js"), "utf8")}\nrun().then(o=>console.log(o.join("\\n")+"\\nDONE"))`);
  const inNode = spawnSync(process.execPath, [join(scratch, "node-full.js")], { encoding: "utf8", cwd: app, maxBuffer: 1 << 26 }).stdout ?? "";

  if (!inNode.trim().endsWith("DONE")) throw new Error("The Node run didn't finish:\n" + inNode.slice(0, 600));
  if (inHermes === inNode) {
    console.log(`Hermes and Node agree on all ${inNode.trim().split("\n").length - 1} outputs.`);
  } else {
    const h = inHermes.split("\n"), n = inNode.split("\n");
    const at = n.findIndex((line, i) => line !== h[i]);
    console.error(`MISMATCH at line ${at + 1}\n  hermes: ${(h[at] ?? "").slice(0, 200)}\n  node:   ${(n[at] ?? "").slice(0, 200)}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
