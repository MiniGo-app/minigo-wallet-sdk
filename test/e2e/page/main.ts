// The e2e dApp page: Stellar Wallets Kit, @stellar/freighter-api and the MiniGo module.
import { Networks, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import * as freighter from "@stellar/freighter-api";
import { Account, Address, Asset, hash, Keypair, nativeToScVal, Operation, TransactionBuilder, xdr } from "@stellar/stellar-base";
import { MiniGoModule } from "../../../src/kit/minigo.module.ts";
import { verifyMessage } from "../../../src/core/signing.ts";

const TESTNET = Networks.TESTNET;

function paymentXdr(source: string) {
  return new TransactionBuilder(new Account(source, "1"), { fee: "100", networkPassphrase: TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
    .setTimeout(300)
    .build()
    .toXDR();
}

function authPreimage() {
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(new TextEncoder().encode(TESTNET) as never),
      nonce: xdr.Int64.fromString("7"),
      signatureExpirationLedger: 100,
      invocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC").toScAddress(),
            functionName: "transfer",
            args: [nativeToScVal(5n, { type: "i128" })],
          }),
        ),
        subInvocations: [],
      }),
    }),
  );
}

const b64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const txSignedBy = (signed: string, address: string) => {
  const tx = TransactionBuilder.fromXDR(signed, TESTNET);
  return tx.signatures.some((s) => Keypair.fromPublicKey(address).verify(tx.hash(), s.signature()));
};
const entrySignedBy = (preimage: xdr.HashIdPreimage, signature: string, address: string) =>
  Keypair.fromPublicKey(address).verify(hash(preimage.toXDR()), b64(signature) as never);

const settle = async <T,>(p: Promise<T>) => {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return { ok: false as const, code: err?.code, message: err?.message ?? String(e) };
  }
};

declare global {
  interface Window {
    kitFlow: (walletId: string) => Promise<Record<string, unknown>>;
    freighterFlow: () => Promise<Record<string, unknown>>;
    listWallets: () => Promise<{ id: string; isAvailable: boolean }[]>;
    rejectFlow: () => Promise<Record<string, unknown>>;
    payFlow: (to: string) => Promise<Record<string, unknown>>;
  }
}

StellarWalletsKit.init({ modules: [...defaultModules(), new MiniGoModule()], network: TESTNET });

window.listWallets = async () => (await StellarWalletsKit.refreshSupportedWallets()).map((w) => ({ id: w.id, isAvailable: w.isAvailable }));

// Every kit call through one wallet module, with signatures checked.
window.kitFlow = async (walletId) => {
  StellarWalletsKit.setWallet(walletId);
  const out: Record<string, unknown> = {};
  const connected = await settle(StellarWalletsKit.fetchAddress());
  out.connected = connected.ok;
  if (!connected.ok) return { ...out, error: connected };
  const address = connected.value.address;
  out.address = address;
  const net = await settle(StellarWalletsKit.getNetwork());
  out.networkPassphrase = net.ok ? net.value.networkPassphrase : net;
  const tx = await settle(StellarWalletsKit.signTransaction(paymentXdr(address), { networkPassphrase: TESTNET, address }));
  out.signTransaction = tx.ok ? txSignedBy(tx.value.signedTxXdr, address) : tx;
  const preimage = authPreimage();
  const entry = await settle(StellarWalletsKit.signAuthEntry(preimage.toXDR("base64"), { networkPassphrase: TESTNET, address }));
  out.signAuthEntry = entry.ok ? entrySignedBy(preimage, entry.value.signedAuthEntry, address) : entry;
  const message = "Sign in to example.com at 2026-09-28T12:00:00Z";
  const signed = await settle(StellarWalletsKit.signMessage(message, { networkPassphrase: TESTNET, address }));
  out.signMessage = signed.ok ? verifyMessage(address, message, signed.value.signedMessage) : signed;
  const wrongNet = await settle(StellarWalletsKit.signTransaction(paymentXdr(address), { networkPassphrase: Networks.PUBLIC }));
  out.wrongNetworkRejected = !wrongNet.ok ? wrongNet.code : "signed!";
  return out;
};

window.rejectFlow = async () => {
  const address = (await StellarWalletsKit.getAddress()).address;
  const r = await settle(StellarWalletsKit.signTransaction(paymentXdr(address), { networkPassphrase: TESTNET }));
  return { rejectedCode: r.ok ? "signed!" : r.code };
};

// Every @stellar/freighter-api call (the Freighter fallback).
window.freighterFlow = async () => {
  const out: Record<string, unknown> = {};
  out.isConnected = (await freighter.isConnected()).isConnected;
  out.isAllowedBefore = (await freighter.isAllowed()).isAllowed;
  out.getAddressBefore = (await freighter.getAddress()).address;
  const access = await freighter.requestAccess();
  const address = access.address;
  out.requestAccess = !!address && !access.error;
  out.isAllowedAfter = (await freighter.isAllowed()).isAllowed;
  out.getAddressAfter = (await freighter.getAddress()).address === address;
  out.setAllowed = (await freighter.setAllowed()).isAllowed;
  const net = await freighter.getNetworkDetails();
  out.networkDetails = { network: net.network, passphrase: net.networkPassphrase, url: net.networkUrl, rpc: net.sorobanRpcUrl };
  const tx = await freighter.signTransaction(paymentXdr(address), { networkPassphrase: TESTNET, address });
  out.signTransaction = !tx.error && txSignedBy(tx.signedTxXdr, address);
  const preimage = authPreimage();
  const entry = await freighter.signAuthEntry(preimage.toXDR("base64"), { networkPassphrase: TESTNET, address });
  out.signAuthEntry = !entry.error && !!entry.signedAuthEntry && entrySignedBy(preimage, String(entry.signedAuthEntry), address);
  const msg = await freighter.signMessage("hello from freighter-api", { networkPassphrase: TESTNET, address });
  out.signMessage = !msg.error && verifyMessage(address, "hello from freighter-api", String(msg.signedMessage));
  const token = await freighter.addToken({ contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" });
  out.addTokenErrorCode = (token.error as { code?: number } | undefined)?.code ?? "no error";
  out.watch = await new Promise((resolve) => {
    const w = new freighter.WatchWalletChanges(300);
    w.watch((v) => {
      w.stop();
      resolve(v.address === address && v.networkPassphrase === TESTNET);
    });
  });
  return out;
};

// A real testnet payment through window.mini.requestPayment.
window.payFlow = async (to) => {
  const mini = (window as unknown as { mini: { requestPayment(p: object): Promise<{ hash: string; error?: { code: number; message: string } }> } }).mini;
  return mini.requestPayment({ to, amount: "2", asset: "XLM", memo: "e2e test" });
};

document.getElementById("out")!.textContent = "ready";
