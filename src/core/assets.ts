import { Asset } from "@stellar/stellar-base";
import type { NetworkConfig } from "./network.ts";

// Circle's USDC issuers (testnet: faucet.circle.com; mainnet: centre.io).
export const USDC_ISSUER: Record<NetworkConfig["network"], string> = {
  TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  PUBLIC: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
};

/** "XLM", "USDC" or "CODE:ISSUER" → a Stellar Asset, or null when it isn't a valid asset. */
export function parseAsset(input: string | undefined, network: NetworkConfig["network"]): Asset | null {
  const value = (input ?? "XLM").trim();
  if (/^xlm$|^native$/i.test(value)) return Asset.native();
  if (/^usdc$/i.test(value)) return new Asset("USDC", USDC_ISSUER[network]);
  const [code, issuer] = value.split(":");
  try {
    return code && issuer ? new Asset(code, issuer) : null;
  } catch {
    return null;
  }
}

export const assetKey = (asset: Asset) => (asset.isNative() ? "XLM" : `${asset.getCode()}:${asset.getIssuer()}`);
