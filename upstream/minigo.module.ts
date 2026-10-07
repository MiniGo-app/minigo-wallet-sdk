import { type ModuleInterface, ModuleType } from "../../types/mod.ts";
import { parseError } from "../utils.ts";

/**
 * Stellar Wallets Kit module for MiniGo. It talks to `window.mini` (SEP-43) directly, so it targets MiniGo even when
 * Freighter is installed. The provider resolves with `{ error }` instead of throwing, so errors are unwrapped here.
 */

type ProviderError = { code: number; message: string; ext?: string[] };
type Opts = { networkPassphrase?: string; address?: string };

interface MiniGoProvider {
  isMiniGo: true;
  isConnected(): Promise<{ isConnected: boolean }>;
  requestAccess(): Promise<{ address: string; error?: ProviderError }>;
  getAddress(): Promise<{ address: string; error?: ProviderError }>;
  signTransaction(
    xdr: string,
    opts?: Opts,
  ): Promise<{ signedTxXdr: string; signerAddress?: string; error?: ProviderError }>;
  signAuthEntry(
    authEntry: string,
    opts?: Opts,
  ): Promise<{ signedAuthEntry: string; signerAddress?: string; error?: ProviderError }>;
  signMessage(
    message: string,
    opts?: Opts,
  ): Promise<{ signedMessage: string; signerAddress?: string; error?: ProviderError }>;
  getNetwork(): Promise<{ network: string; networkPassphrase: string; error?: ProviderError }>;
}

type MiniGoWindow = Window & {
  stellar?: { provider: string; platform: string; version: string };
  mini?: MiniGoProvider;
};

const win = () => (typeof window === "undefined" ? undefined : (window as MiniGoWindow));

export const MINIGO_ID: string = "minigo";

// The provider is injected before page scripts, so this only covers odd load orders. The kit allows 1000 ms.
const MINIGO_AVAILABILITY_WAIT_MS = 600;

export class MiniGoModule implements ModuleInterface {
  moduleType: ModuleType = ModuleType.HOT_WALLET;

  productId: string = MINIGO_ID;
  productName: string = "MiniGo";
  productUrl: string = "https://minigo.app";
  productIcon: string =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOSIgZmlsbD0iIzBCMEIwRCIvPjxwYXRoIGQ9Ik05IDIyVjEwbDcgNyA3LTd2MTIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4=";

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

  isPlatformWrapper(): Promise<boolean> {
    const w = win();
    return Promise.resolve(w?.stellar?.provider === "minigo" && w.stellar.platform === "mobile");
  }

  async getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }> {
    try {
      const provider = this.provider();
      const { address, error } = params?.skipRequestAccess
        ? await provider.getAddress()
        : await provider.requestAccess();
      if (error) return Promise.reject(parseError(error));
      if (!address) {
        return Promise.reject({ code: -3, message: "MiniGo didn't return an address. Please connect first." });
      }
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
      if (!signedAuthEntry) {
        return Promise.reject({ code: -3, message: "signedAuthEntry returned from MiniGo is undefined." });
      }
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
      if (!signedMessage) {
        return Promise.reject({ code: -3, message: "signedMessage returned from MiniGo is undefined." });
      }
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
