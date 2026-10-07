// SEP-43 errors. Users see these messages.
export type WalletError = { code: -1 | -2 | -3 | -4; message: string; ext?: string[] };

export const internalError = (ext?: string[]): WalletError => ({
  code: -1,
  message: "The wallet encountered an internal error. Please try again or contact MiniGo if the problem persists.",
  ...(ext ? { ext } : {}),
});

export const externalError = (message: string, ext?: string[]): WalletError => ({ code: -2, message, ...(ext ? { ext } : {}) });

export const invalidRequest = (...ext: string[]): WalletError => ({
  code: -3,
  message: "Request is invalid. Please check the details and try again.",
  ...(ext.length ? { ext } : {}),
});

export const userRejected = (): WalletError => ({ code: -4, message: "The user rejected this request." });

export const TOO_MANY_PENDING = "too_many_pending";
export const tooManyPending = (): WalletError => ({
  code: -1,
  message: "MiniGo is still waiting for an answer to this site's earlier requests. Try again after those.",
  ext: [TOO_MANY_PENDING],
});

export function isWalletError(value: unknown): value is WalletError {
  const error = value as WalletError | null;
  return !!error && typeof error.message === "string" && [-1, -2, -3, -4].includes(error.code);
}
