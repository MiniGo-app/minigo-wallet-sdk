import { ModuleType, parseError, type ModuleInterface } from "@creit.tech/stellar-wallets-kit";
import { MINIGO_ICON } from "./icon.ts";

/**
 * Stellar Wallets Kit module for MiniGo.
 *
 * MiniGo injects a SEP-43 provider as `window.mini` in its in-app browser and extension,
 * together with a frozen `window.stellar` detection sentinel.
 * The provider never throws: methods resolve with `{ ..., error? }`, so this module unwraps `error` into a
 * rejection to match the kit's throw-on-failure contract.
 *
 * It uses `window.mini` directly so another installed wallet cannot intercept requests.
 *
 * This file mirrors `upstream/minigo.module.ts`, the version proposed for the kit itself; only the imports differ.
 */

type ProviderError = { code: number; message: string; ext?: string[] };
type Opts = { networkPassphrase?: string; address?: string };

interface MiniGoProvider {
  isMiniGo: true;
  isConnected(): Promise<{ isConnected: boolean }>;
  requestAccess(): Promise<{ address: string; error?: ProviderError }>;
  getAddress(): Promise<{ address: string; error?: ProviderError }>;
  signTransaction(xdr: string, opts?: Opts): Promise<{ signedTxXdr: string; signerAddress?: string; error?: ProviderError }>;
  signAuthEntry(authEntry: string, opts?: Opts): Promise<{ signedAuthEntry: string; signerAddress?: string; error?: ProviderError }>;
  signMessage(message: string, opts?: Opts): Promise<{ signedMessage: string; signerAddress?: string; error?: ProviderError }>;
  getNetwork(): Promise<{ network: string; networkPassphrase: string; error?: ProviderError }>;
}

type MiniGoWindow = Window & {
  stellar?: { provider: string; platform: string; version: string };
  mini?: MiniGoProvider;
};

const win = () => (typeof window === "undefined" ? undefined : (window as MiniGoWindow));

export const MINIGO_ID: string = "minigo";

/**
 * How long isAvailable() waits for the provider to appear. The provider is injected before page scripts, so
 * this only covers unusual load orders; it stays inside the kit's 1000ms isAvailable budget.
 */
const MINIGO_AVAILABILITY_WAIT_MS = 600;

export class MiniGoModule implements ModuleInterface {
  moduleType: ModuleType = ModuleType.HOT_WALLET;

  productId: string = MINIGO_ID;
  productName: string = "MiniGo";
  productUrl: string = "https://minigo.app";
  productIcon: string = MINIGO_ICON;

  private provider(): MiniGoProvider {
    const provider = win()?.mini;
    if (!provider?.isMiniGo) throw parseError({ code: -1, message: "MiniGo is not available" });
    return provider;
  }

  private isReady(): boolean {
    const w = win();
    return w?.stellar?.provider === "minigo" && !!w.mini?.isMiniGo;
  }

  async isAvailable(): Promise<boolean> {
    const w = win();
    if (!w) return false;
    if (this.isReady()) return true;
    return new Promise<boolean>((resolve) => {
      const done = (value: boolean) => {
        clearTimeout(timer);
        w.removeEventListener("minigo#initialized", onReady);
        resolve(value);
      };
      const onReady = () => done(this.isReady());
      const timer = setTimeout(() => done(this.isReady()), MINIGO_AVAILABILITY_WAIT_MS);
      w.addEventListener("minigo#initialized", onReady, { once: true });
    });
  }

  /** Inside MiniGo's own app browser, the kit can pick MiniGo without asking. */
  isPlatformWrapper(): Promise<boolean> {
    const w = win();
    return Promise.resolve(w?.stellar?.provider === "minigo" && w.stellar.platform === "mobile");
  }

  async getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }> {
    try {
      const provider = this.provider();
      const { address, error } = params?.skipRequestAccess ? await provider.getAddress() : await provider.requestAccess();
      if (error) return Promise.reject(parseError(error));
      if (!address) return Promise.reject({ code: -3, message: "MiniGo didn't return an address. Please connect first." });
      return { address };
    } catch (e) {
      throw parseError(e);
    }
  }

  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }> {
    try {
      const { signedTxXdr, signerAddress, error } = await this.provider().signTransaction(xdr, {
        networkPassphrase: opts?.networkPassphrase,
        address: opts?.address,
      });
      if (error) return Promise.reject(parseError(error));
      return { signedTxXdr, signerAddress };
    } catch (e) {
      throw parseError(e);
    }
  }

  async signAuthEntry(
    authEntry: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedAuthEntry: string; signerAddress?: string }> {
    try {
      const { signedAuthEntry, signerAddress, error } = await this.provider().signAuthEntry(authEntry, {
        networkPassphrase: opts?.networkPassphrase,
        address: opts?.address,
      });
      if (error) return Promise.reject(parseError(error));
      if (!signedAuthEntry) return Promise.reject({ code: -3, message: "signedAuthEntry returned from MiniGo is undefined." });
      return { signedAuthEntry, signerAddress };
    } catch (e) {
      throw parseError(e);
    }
  }

  async signMessage(
    message: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedMessage: string; signerAddress?: string }> {
    try {
      const { signedMessage, signerAddress, error } = await this.provider().signMessage(message, {
        networkPassphrase: opts?.networkPassphrase,
        address: opts?.address,
      });
      if (error) return Promise.reject(parseError(error));
      if (!signedMessage) return Promise.reject({ code: -3, message: "signedMessage returned from MiniGo is undefined." });
      return { signedMessage, signerAddress };
    } catch (e) {
      throw parseError(e);
    }
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    try {
      const { network, networkPassphrase, error } = await this.provider().getNetwork();
      if (error) return Promise.reject(parseError(error));
      return { network, networkPassphrase };
    } catch (e) {
      throw parseError(e);
    }
  }
}
