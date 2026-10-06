// Runs in Hermes and in Node; the two outputs must match exactly. Copied to minigo/.parity/ by run.mjs.
import { Account, Address, Asset, Keypair, Memo, Networks, Operation, TransactionBuilder, hash, nativeToScVal, xdr } from "@stellar/stellar-base";
import { deriveAccount } from "../src/wallet/stellar";
import { describeTransaction, describeAuthEntry } from "../../minigo-wallet-sdk/src/core/describe";
import { transactionHashHex, transactionXdr } from "../../minigo-wallet-sdk/src/core/encode";
import { parseTransaction, signAuthEntryXdr, signMessageText, signTransactionXdr } from "../../minigo-wallet-sdk/src/core/signing";

const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const DEST = "GBAW5XGWORWVFE2XTJYDTLDHXTY2Q2MO73HYCGB3XMFMQ562Q2W2GJQX";
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const TESTNET = Networks.TESTNET;
const u8 = (s: string) => new TextEncoder().encode(s);

(globalThis as any).run = async () => {
  const out: string[] = [];
  const { publicKey, secretSeed } = await deriveAccount(PHRASE);
  const kp = Keypair.fromRawEd25519Seed(secretSeed as never);
  out.push("pub " + publicKey);
  const build = (op: any, memo?: string) => {
    const b = new TransactionBuilder(new Account(publicKey, "100"), { fee: "1000", networkPassphrase: TESTNET }).addOperation(op).setTimebounds(0, 1900000000);
    if (memo) b.addMemo(Memo.text(memo));
    return b.build();
  };
  const cases: [string, any, string?][] = [
    ["pay", Operation.payment({ destination: DEST, asset: Asset.native(), amount: "1" })],
    ["pay+memo", Operation.payment({ destination: DEST, asset: Asset.native(), amount: "1.5" }), "Test order #1"],
    ["usdc", Operation.payment({ destination: DEST, asset: USDC, amount: "12.3456789" })],
    ["trust", Operation.changeTrust({ asset: USDC })],
    ["create", Operation.createAccount({ destination: DEST, startingBalance: "2" })],
  ];
  for (const [name, op, memo] of cases) {
    const tx = build(op, memo);
    const unsignedXdr = transactionXdr(tx);
    tx.sign(kp);
    out.push(`${name} hash=${transactionHashHex(tx)} signed=${transactionXdr(tx)}`);
    const viaHost = signTransactionXdr(kp, unsignedXdr, TESTNET);
    out.push(`${name} signTransactionXdr=${viaHost.ok ? viaHost.value.signedTxXdr : "ERR " + JSON.stringify(viaHost.error)}`);
    const parsed = parseTransaction(unsignedXdr, TESTNET);
    const probe = (label: string, f: () => any) => { try { out.push(`${name} ${label}=` + JSON.stringify(f())); } catch (e: any) { out.push(`${name} ${label} THROWS ${e && e.message}`); } };
    if (parsed.ok) {
      const t: any = parsed.value;
      probe("source", () => t.source);
      probe("fee", () => t.fee);
      probe("memo", () => t.memo);
      probe("memoType", () => t._memo && t._memo.switch().name);
      probe("ops", () => t.operations.map((o: any) => o.type));
      probe("describe", () => describeTransaction(parsed.value, publicKey));
    } else out.push(`${name} parse ERR`);
  }
  const msg = signMessageText(Keypair.fromSecret("SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW"), "Hello, World!", TESTNET);
  out.push("sep53 " + (msg.ok ? msg.value.signedMessage : "ERR"));
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: Address.fromString("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC").toScAddress(), functionName: "transfer", args: [nativeToScVal(publicKey, { type: "address" }), nativeToScVal(1234n, { type: "i128" })] }),
    ),
    subInvocations: [],
  });
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({ networkId: hash(u8(TESTNET) as never), nonce: xdr.Int64.fromString("42"), signatureExpirationLedger: 1000, invocation }),
  );
  const authB64 = ((): string => { const raw = preimage.toXDR(); const b = new Uint8Array(raw); let s = ""; const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; for (let i = 0; i < b.length; i += 3) { const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0); s += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : "=") + (i + 2 < b.length ? A[n & 63] : "="); } return s; })();
  const auth = signAuthEntryXdr(kp, authB64, TESTNET);
  out.push("authEntry " + (auth.ok ? auth.value.signedAuthEntry : "ERR " + JSON.stringify(auth.error)));
  out.push("authDescribe " + JSON.stringify(describeAuthEntry(preimage)));
  return out;
};
