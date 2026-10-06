import { Address, FeeBumpTransaction, scValToNative, xdr, type Operation, type Transaction } from "@stellar/stellar-base";

// Plain-language lines describing a transaction, for approval screens.

const short = (address?: string) => (address && address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address ?? "");

function assetLabel(asset?: { isNative(): boolean; getCode(): string }) {
  return !asset || asset.isNative() ? "XLM" : asset.getCode();
}

export function describeOperation(op: Operation): string {
  switch (op.type) {
    case "payment":
      return `Pay ${op.amount} ${assetLabel(op.asset)} to ${short(op.destination)}`;
    case "createAccount":
      return `Create account ${short(op.destination)} with ${op.startingBalance} XLM`;
    case "pathPaymentStrictSend":
      return `Send ${op.sendAmount} ${assetLabel(op.sendAsset)}, ${short(op.destination)} gets at least ${op.destMin} ${assetLabel(op.destAsset)}`;
    case "pathPaymentStrictReceive":
      return `Send up to ${op.sendMax} ${assetLabel(op.sendAsset)} so ${short(op.destination)} gets ${op.destAmount} ${assetLabel(op.destAsset)}`;
    case "changeTrust":
      return "line" in op && op.line && "getCode" in op.line
        ? Number(op.limit) === 0
          ? `Remove ${op.line.getCode()} from the wallet`
          : `Add ${op.line.getCode()} to the wallet`
        : "Change a trustline";
    case "invokeHostFunction": {
      const fn = op.func;
      if (fn.switch().name === "hostFunctionTypeInvokeContract") {
        const args = fn.invokeContract();
        return `Call ${args.functionName().toString()} on a smart contract`;
      }
      return "Run a smart contract function";
    }
    case "manageSellOffer":
    case "manageBuyOffer":
    case "createPassiveSellOffer":
      return "Place or change a trade offer";
    case "setOptions":
      return "Change account settings (signers, thresholds or flags)";
    case "accountMerge":
      return `Close this account and send everything to ${short(op.destination)}`;
    default:
      return `Operation: ${op.type}`;
  }
}

export type TransactionSummary = {
  source: string;
  fee: string;
  memo?: string;
  operations: string[];
  risky: boolean;
  /** The transaction's own source account is the wallet's. */
  sourceIsYou: boolean;
  /** Some operation names the wallet's account as its source, so signing lets it act for that account. */
  usesYourAccount: boolean;
};

/**
 * Lines for an approval screen. Operations that act for a different account than the transaction's source
 * say so ("from your account" or the other address), so a transaction built by someone else can't pass off
 * an operation drawn on the wallet as the builder's own.
 */
export function describeTransaction(tx: Transaction | FeeBumpTransaction, wallet?: string): TransactionSummary {
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  const operations = inner.operations.map((op) => {
    const line = describeOperation(op);
    if (!op.source || op.source === inner.source) return line;
    return `${line} (from ${op.source === wallet ? "your account" : short(op.source)})`;
  });
  const memo = inner.memo.type === "text" ? String(inner.memo.value) : inner.memo.type === "none" ? undefined : String(inner.memo.value);
  return {
    source: inner.source,
    fee: (Number(tx.fee) / 1e7).toFixed(7).replace(/\.?0+$/, ""),
    memo,
    operations,
    // Operations that can hand over control of the account deserve a warning.
    risky: inner.operations.some((op) => op.type === "setOptions" || op.type === "accountMerge"),
    sourceIsYou: inner.source === wallet,
    usesYourAccount: inner.source === wallet || inner.operations.some((op) => op.source === wallet),
  };
}

export type AuthEntryDetails = {
  /** Contract being called, when the entry authorizes a contract function call. */
  contract?: string;
  functionName?: string;
  /** The call's arguments, as readable text. */
  args: string[];
  /** Further calls the entry also authorizes (nested calls made by the contract). */
  nestedCalls: number;
  expiresAtLedger?: number;
};

const argText = (value: xdr.ScVal) => {
  try {
    const native = scValToNative(value);
    const text =
      typeof native === "string" || typeof native === "bigint" || typeof native === "number"
        ? String(native)
        : JSON.stringify(native, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  } catch {
    return `(${value.switch().name})`;
  }
};

const countNested = (call: xdr.SorobanAuthorizedInvocation): number =>
  call.subInvocations().reduce((sum, sub) => sum + 1 + countNested(sub), 0);

/** What a Soroban authorization entry would let a contract do, for an approval screen. */
export function describeAuthEntry(preimage: xdr.HashIdPreimage): AuthEntryDetails {
  const auth = preimage.sorobanAuthorization();
  const root = auth.invocation();
  const details: AuthEntryDetails = { args: [], nestedCalls: countNested(root), expiresAtLedger: auth.signatureExpirationLedger() };
  const fn = root.function();
  if (fn.switch().name === "sorobanAuthorizedFunctionTypeContractFn") {
    const call = fn.contractFn();
    details.contract = Address.fromScAddress(call.contractAddress()).toString();
    details.functionName = call.functionName().toString();
    details.args = call.args().map(argText);
  }
  return details;
}
