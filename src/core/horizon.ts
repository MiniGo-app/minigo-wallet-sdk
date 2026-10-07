import { Account, Asset, Keypair, Memo, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-base";
import { externalError, invalidRequest, type WalletError } from "./errors.ts";
import { transactionHashHex, transactionXdr } from "./encode.ts";
import type { NetworkConfig } from "./network.ts";

// Plain fetch instead of the SDK's server class, so this runs in extension workers and React Native as is.

export type Balance = { asset: Asset; balance: string; limit?: string };
export type AccountState =
  | { exists: false }
  | {
      exists: true;
      sequence: string;
      balances: Balance[];
      subentries: number;
      sponsoring: number;
      sponsored: number;
      baseReserve: number;
      // Unchanged means nothing happened on the account.
      lastModifiedLedger: number;
    };

// Used when the ledger can't be read. Validators can change the real value.
export const FALLBACK_BASE_RESERVE = 0.5;

const OFFLINE = "Couldn't reach Stellar. Check your connection and try again.";

const RETRY_DELAYS = [400, 1200];

// A phone clock a few minutes off would make every payment expire, so time bounds use Horizon's clock.
let serverOffsetMs = 0;

export function networkNowSeconds() {
  return Math.floor((Date.now() + serverOffsetMs) / 1000);
}

function validFor<T extends { setTimebounds(min: number, max: number): T }>(builder: T, seconds = 180): T {
  return builder.setTimebounds(0, networkNowSeconds() + seconds);
}

async function horizon(network: NetworkConfig, path: string, init?: RequestInit) {
  const url = `${network.networkUrl}${path}`;
  // Retrying a signed transaction is safe, it can only land once.
  const delays = RETRY_DELAYS;
  let response: Response | undefined;
  for (let attempt = 0; !response; attempt++) {
    response = await fetch(url, init).catch(async () => {
      if (attempt >= delays.length) throw externalError(OFFLINE);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      return undefined;
    });
  }
  const served = Date.parse(response.headers?.get?.("date") ?? "");
  if (Number.isFinite(served)) serverOffsetMs = served - Date.now();
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

const RESERVE_TTL = 10 * 60 * 1000;
const reserves = new Map<string, { value: number; at: number }>();

export async function loadBaseReserve(network: NetworkConfig): Promise<number> {
  const cached = reserves.get(network.networkPassphrase);
  if (cached && Date.now() - cached.at < RESERVE_TTL) return cached.value;
  try {
    const { status, body } = await horizon(network, "/ledgers?order=desc&limit=1");
    const stroops = Number(body?._embedded?.records?.[0]?.base_reserve_in_stroops);
    if (status === 200 && Number.isFinite(stroops) && stroops > 0) {
      const value = stroops / 1e7;
      reserves.set(network.networkPassphrase, { value, at: Date.now() });
      return value;
    }
  } catch {
    // Use the fallback.
  }
  return cached?.value ?? FALLBACK_BASE_RESERVE;
}

type HorizonBalance = { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string; limit?: string };

export async function loadAccount(network: NetworkConfig, address: string): Promise<AccountState> {
  const [{ status, body }, baseReserve] = await Promise.all([horizon(network, `/accounts/${address}`), loadBaseReserve(network)]);
  if (status === 404) return { exists: false };
  if (status !== 200) throw externalError(OFFLINE);
  return {
    exists: true,
    baseReserve,
    sequence: body.sequence,
    lastModifiedLedger: Number(body.last_modified_ledger ?? 0),
    subentries: body.subentry_count ?? 0,
    sponsoring: body.num_sponsoring ?? 0,
    sponsored: body.num_sponsored ?? 0,
    balances: (body.balances as HorizonBalance[])
      .filter((b) => b.asset_type === "native" || b.asset_type.startsWith("credit_"))
      .map((b) => ({
        asset: b.asset_type === "native" ? Asset.native() : new Asset(b.asset_code!, b.asset_issuer!),
        balance: b.balance,
        limit: b.limit,
      })),
  };
}

// Balance minus the reserve (one base reserve per entry and 2 for the account) and a little for fees.
export function spendableXlm(state: Extract<AccountState, { exists: true }>) {
  const native = state.balances.find((b) => b.asset.isNative());
  const reserve = state.baseReserve * (2 + state.subentries + state.sponsoring - state.sponsored);
  return Math.max(0, Number(native?.balance ?? 0) - reserve - 0.01);
}

export async function fundWithFriendbot(network: NetworkConfig, address: string) {
  if (!network.friendbotUrl) throw invalidRequest("Friendbot only exists on testnet");
  const response = await fetch(`${network.friendbotUrl}/?addr=${encodeURIComponent(address)}`).catch(() => {
    throw externalError(OFFLINE);
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw externalError(body.detail ?? "Friendbot couldn't fund this account. Try again in a minute.");
  }
}

function explainFailure(body: { extras?: { result_codes?: { transaction?: string; operations?: string[] } }; title?: string }): WalletError {
  const codes = body.extras?.result_codes;
  const ops = codes?.operations ?? [];
  const friendly: Record<string, string> = {
    op_underfunded: "Not enough balance for this payment.",
    op_no_trust: "The recipient hasn't added this asset yet.",
    op_no_destination: "The recipient's account doesn't exist yet.",
    op_line_full: "The recipient can't hold that much of this asset.",
    op_low_reserve: "This would leave the account below Stellar's minimum balance.",
    tx_bad_seq: "The wallet was out of date. Please try again.",
    tx_insufficient_fee: "The network is busy. Please try again.",
    tx_too_late: "The request expired. Please try again.",
  };
  const message = ops.map((op) => friendly[op]).find(Boolean) ?? friendly[codes?.transaction ?? ""] ?? "Stellar rejected the transaction.";
  return externalError(message, [codes?.transaction, ...ops].filter((x): x is string => !!x));
}

export async function submitTransaction(network: NetworkConfig, tx: Transaction) {
  const { status, body } = await horizon(network, "/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `tx=${encodeURIComponent(transactionXdr(tx))}`,
  });
  if (status === 504) return awaitTransaction(network, transactionHashHex(tx));
  if (status !== 200 || !body.successful) throw explainFailure(body);
  return { hash: body.hash as string, ledger: body.ledger as number };
}

// After a Horizon timeout the transaction may still land.
async function awaitTransaction(network: NetworkConfig, hash: string) {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const { status, body } = await horizon(network, `/transactions/${hash}`).catch(() => ({ status: 0, body: {} }));
    if (status === 200) {
      if (!body.successful) throw externalError("Stellar rejected the transaction.");
      return { hash, ledger: body.ledger as number };
    }
  }
  throw externalError("The network is slow to confirm this. Check your activity before trying again.");
}

export type PaymentPlan = {
  tx: Transaction;
  createsAccount: boolean;
};

// XLM to an account that doesn't exist creates it. Other assets need an existing account with a trustline.
export async function buildPayment(
  network: NetworkConfig,
  params: { source: string; to: string; asset: Asset; amount: string; memo?: string },
): Promise<PaymentPlan> {
  const [source, destination] = await Promise.all([loadAccount(network, params.source), loadAccount(network, params.to)]);
  if (!source.exists) throw invalidRequest("This wallet isn't funded yet.");
  if (params.to === params.source) throw invalidRequest("You can't pay yourself.");

  let operation;
  let createsAccount = false;
  if (!destination.exists) {
    if (!params.asset.isNative()) throw invalidRequest("The recipient's account doesn't exist yet, so it can only receive XLM.");
    const minimum = 2 * source.baseReserve;
    if (Number(params.amount) < minimum) throw invalidRequest(`A new Stellar account needs at least ${minimum} XLM.`);
    operation = Operation.createAccount({ destination: params.to, startingBalance: params.amount });
    createsAccount = true;
  } else {
    if (!params.asset.isNative() && !destination.balances.some((b) => b.asset.equals(params.asset))) {
      throw invalidRequest(`The recipient hasn't added ${params.asset.getCode()} to their wallet yet.`);
    }
    operation = Operation.payment({ destination: params.to, asset: params.asset, amount: params.amount });
  }

  const builder = new TransactionBuilder(new Account(params.source, source.sequence), {
    fee: "1000",
    networkPassphrase: network.networkPassphrase,
  })
    .addOperation(operation);
  validFor(builder);
  if (params.memo) builder.addMemo(Memo.text(params.memo));
  return { tx: builder.build(), createsAccount };
}

export async function buildChangeTrust(network: NetworkConfig, source: string, asset: Asset, remove = false) {
  const account = await loadAccount(network, source);
  if (!account.exists) throw invalidRequest("This wallet isn't funded yet.");
  const builder = new TransactionBuilder(new Account(source, account.sequence), { fee: "1000", networkPassphrase: network.networkPassphrase })
    .addOperation(Operation.changeTrust({ asset, ...(remove ? { limit: "0" } : {}) }));
  return validFor(builder).build();
}

export const signAndSubmit = (network: NetworkConfig, tx: Transaction, keypair: Keypair) => {
  tx.sign(keypair);
  return submitTransaction(network, tx);
};
