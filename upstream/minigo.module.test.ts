/// <reference lib="deno.ns" />
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MiniGoModule } from "./minigo.module.ts";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;

interface FakeWin extends EventTarget {
  stellar?: { provider: string; platform: string; version: string };
  mini?: Record<string, unknown>;
}

function makeWindow(): FakeWin {
  const win = new EventTarget() as FakeWin;
  g.window = win;
  return win;
}

function clearWindow(): void {
  delete g.window;
}

const SENTINEL = { provider: "minigo", platform: "mobile", version: "0.1.0" } as const;
const ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";

function provider(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isMiniGo: true,
    isConnected: () => Promise.resolve({ isConnected: true }),
    requestAccess: () => Promise.resolve({ address: ADDRESS }),
    getAddress: () => Promise.resolve({ address: ADDRESS }),
    signTransaction: (xdr: string) => Promise.resolve({ signedTxXdr: `${xdr}+sig`, signerAddress: ADDRESS }),
    signAuthEntry: () => Promise.resolve({ signedAuthEntry: "c2ln", signerAddress: ADDRESS }),
    signMessage: () => Promise.resolve({ signedMessage: "c2ln", signerAddress: ADDRESS }),
    getNetwork: () => Promise.resolve({ network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" }),
    ...overrides,
  };
}

Deno.test("isAvailable(): true once minigo#initialized fires, even if called before injection", async () => {
  const win = makeWindow();
  try {
    const pending = new MiniGoModule().isAvailable();
    win.stellar = { ...SENTINEL };
    win.mini = provider();
    win.dispatchEvent(new Event("minigo#initialized"));
    assertEquals(await pending, true);
  } finally {
    clearWindow();
  }
});

Deno.test("isAvailable(): false when MiniGo is never injected", async () => {
  makeWindow();
  try {
    assertEquals(await new MiniGoModule().isAvailable(), false);
  } finally {
    clearWindow();
  }
});

Deno.test("isPlatformWrapper(): true only inside the MiniGo app", async () => {
  const win = makeWindow();
  try {
    win.stellar = { ...SENTINEL };
    win.mini = provider();
    assertEquals(await new MiniGoModule().isPlatformWrapper(), true);
    win.stellar = { ...SENTINEL, platform: "extension" };
    assertEquals(await new MiniGoModule().isPlatformWrapper(), false);
  } finally {
    clearWindow();
  }
});

Deno.test("getAddress(): asks for access unless skipRequestAccess is set", async () => {
  const win = makeWindow();
  const calls: string[] = [];
  try {
    win.stellar = { ...SENTINEL };
    win.mini = provider({
      requestAccess: () => (calls.push("requestAccess"), Promise.resolve({ address: ADDRESS })),
      getAddress: () => (calls.push("getAddress"), Promise.resolve({ address: ADDRESS })),
    });
    const mod = new MiniGoModule();
    assertEquals(await mod.getAddress(), { address: ADDRESS });
    assertEquals(await mod.getAddress({ skipRequestAccess: true }), { address: ADDRESS });
    assertEquals(calls, ["requestAccess", "getAddress"]);
  } finally {
    clearWindow();
  }
});

Deno.test("SEP-43 { error } results become rejections with the same code", async () => {
  const win = makeWindow();
  try {
    win.stellar = { ...SENTINEL };
    win.mini = provider({
      signTransaction: () =>
        Promise.resolve({ signedTxXdr: "", error: { code: -4, message: "The user rejected this request." } }),
    });
    const error = await assertRejects(() => new MiniGoModule().signTransaction("AAAA"));
    assertEquals((error as { code: number }).code, -4);
  } finally {
    clearWindow();
  }
});

Deno.test("signing results and options pass through unchanged", async () => {
  const win = makeWindow();
  let seenOpts: unknown;
  try {
    win.stellar = { ...SENTINEL };
    win.mini = provider({
      signMessage: (
        _m: string,
        opts: unknown,
      ) => (seenOpts = opts, Promise.resolve({ signedMessage: "c2ln", signerAddress: ADDRESS })),
    });
    const mod = new MiniGoModule();
    assertEquals(await mod.signTransaction("AAAA"), { signedTxXdr: "AAAA+sig", signerAddress: ADDRESS });
    assertEquals(await mod.signAuthEntry("BBBB"), { signedAuthEntry: "c2ln", signerAddress: ADDRESS });
    assertEquals(await mod.signMessage("hi", { networkPassphrase: "P", address: ADDRESS }), {
      signedMessage: "c2ln",
      signerAddress: ADDRESS,
    });
    assertEquals(seenOpts, { networkPassphrase: "P", address: ADDRESS });
    assertEquals((await mod.getNetwork()).network, "TESTNET");
  } finally {
    clearWindow();
  }
});

Deno.test("calls without an injected provider reject with code -1", async () => {
  makeWindow();
  try {
    const error = await assertRejects(() => new MiniGoModule().getNetwork());
    assertEquals((error as { code: number }).code, -1);
  } finally {
    clearWindow();
  }
});
