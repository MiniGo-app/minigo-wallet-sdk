// The wallet calls. main.ts wires them to buttons and test/run.mjs drives them in a browser.
import { Networks, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { Account, Address, BASE_FEE, hash, Keypair, Memo, nativeToScVal, Operation, TransactionBuilder, xdr } from "@stellar/stellar-base";
import { MiniGoModule } from "minigo-wallet-sdk/kit";

export const NETWORK = Networks.TESTNET;
export const HORIZON = "https://horizon-testnet.stellar.org";
export const FRIENDBOT = "https://friendbot.stellar.org";
export const WALLET_ID = "minigo";

StellarWalletsKit.init({ modules: [...defaultModules(), new MiniGoModule()], network: NETWORK });

// MiniGo asks the user the first time.
export async function connect() {
  StellarWalletsKit.setWallet(WALLET_ID);
  return StellarWalletsKit.fetchAddress();
}

export const getAddress = () => StellarWalletsKit.getAddress();

export const getNetwork = () => StellarWalletsKit.getNetwork();

// MiniGo keeps its own permission for the site; remove it under Connected apps.
export const disconnect = () => StellarWalletsKit.disconnect();

export async function accountSequence(address: string): Promise<string | null> {
  const response = await fetch(`${HORIZON}/accounts/${address}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Horizon answered ${response.status}`);
  return ((await response.json()) as { sequence: string }).sequence;
}

export async function fundWithFriendbot(address: string) {
  const response = await fetch(`${FRIENDBOT}/?addr=${encodeURIComponent(address)}`);
  if (!response.ok && (await accountSequence(address)) === null) throw new Error(`Friendbot answered ${response.status}`);
}

// Sends 1 XLM to a new account. It uses the real sequence number so testnet accepts it once signed.
export async function buildTransaction(source: string, destination = Keypair.random().publicKey(), sequence?: string) {
  const current = sequence ?? (await accountSequence(source));
  if (current === null) throw new Error("This account doesn't exist on testnet yet. Fund it with Friendbot first.");
  return new TransactionBuilder(new Account(source, current), { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.createAccount({ destination, startingBalance: "1" }))
    .addMemo(Memo.text("wallets-kit example"))
    .setTimeout(300)
    .build();
}

export async function signTransaction(address: string, transaction: { toXDR(): string }, networkPassphrase: string = NETWORK) {
  return StellarWalletsKit.signTransaction(transaction.toXDR(), { networkPassphrase, address });
}

export async function submit(signedTxXdr: string) {
  const response = await fetch(`${HORIZON}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tx: signedTxXdr }),
  });
  const body = (await response.json()) as { hash?: string; successful?: boolean; extras?: { result_codes?: unknown } };
  if (!response.ok) throw new Error(`Rejected by the network: ${JSON.stringify(body.extras?.result_codes ?? body)}`);
  return { hash: body.hash as string };
}

export function isSignedBy(signedTxXdr: string, address: string) {
  const transaction = TransactionBuilder.fromXDR(signedTxXdr, NETWORK);
  return transaction.signatures.some((signature) => Keypair.fromPublicKey(address).verify(transaction.hash(), signature.signature()));
}

// The preimage a dApp hands to signAuthEntry, here for a `transfer` on a sample testnet contract.
export function authEntryPreimage(expirationLedger = 1_000_000) {
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(new TextEncoder().encode(NETWORK) as never),
      nonce: xdr.Int64.fromString("7"),
      signatureExpirationLedger: expirationLedger,
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

export async function signAuthEntry(address: string, preimage = authEntryPreimage()) {
  return StellarWalletsKit.signAuthEntry(preimage.toXDR("base64"), { networkPassphrase: NETWORK, address });
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

// signAuthEntry signs the SHA-256 of the preimage.
export const isAuthEntrySignedBy = (preimage: xdr.HashIdPreimage, signature: string, address: string) =>
  Keypair.fromPublicKey(address).verify(hash(preimage.toXDR()), fromBase64(signature) as never);

export async function signMessage(address: string, message: string) {
  return StellarWalletsKit.signMessage(message, { networkPassphrase: NETWORK, address });
}

// SEP-53 signs SHA-256("Stellar Signed Message:\n" + message).
export function isMessageSignedBy(message: string, signature: string, address: string) {
  const payload = new TextEncoder().encode("Stellar Signed Message:\n" + message);
  return Keypair.fromPublicKey(address).verify(hash(payload as never), fromBase64(signature) as never);
}

export const wallets = async () => (await StellarWalletsKit.refreshSupportedWallets()).map((wallet) => ({ id: wallet.id, isAvailable: wallet.isAvailable }));
