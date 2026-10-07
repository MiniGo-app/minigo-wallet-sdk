import * as flow from "./flow.ts";

const log = document.getElementById("log") as HTMLPreElement;
const show = (label: string, value: unknown) => {
  log.textContent = `${label}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`;
};
const errorText = (error: unknown) => {
  const e = error as { code?: number; message?: string };
  return e?.code !== undefined ? `${e.message} (code ${e.code})` : (e?.message ?? String(error));
};

let address = "";
let signedTx = "";

function on(id: string, run: () => Promise<void>) {
  document.getElementById(id)!.addEventListener("click", async () => {
    try {
      await run();
    } catch (error) {
      show(`${id} failed`, errorText(error));
    }
  });
}

on("connect", async () => {
  address = (await flow.connect()).address;
  show("Connected", address);
});
on("address", async () => show("getAddress", await flow.getAddress()));
on("network", async () => show("getNetwork", await flow.getNetwork()));
on("fund", async () => {
  await flow.fundWithFriendbot(address || (await flow.getAddress()).address);
  show("Funded", "Friendbot created the account on testnet.");
});
on("tx", async () => {
  address ||= (await flow.getAddress()).address;
  const { signedTxXdr } = await flow.signTransaction(address, await flow.buildTransaction(address));
  signedTx = signedTxXdr;
  show("signTransaction", { signedByWallet: flow.isSignedBy(signedTx, address), signedTxXdr });
});
on("submit", async () => show("Submitted", await flow.submit(signedTx)));
on("auth", async () => {
  address ||= (await flow.getAddress()).address;
  const preimage = flow.authEntryPreimage();
  const { signedAuthEntry } = await flow.signAuthEntry(address, preimage);
  show("signAuthEntry", { signedByWallet: flow.isAuthEntrySignedBy(preimage, signedAuthEntry, address), signedAuthEntry });
});
on("message", async () => {
  address ||= (await flow.getAddress()).address;
  const message = `Sign in to example.com at ${new Date().toISOString()}`;
  const { signedMessage } = await flow.signMessage(address, message);
  show("signMessage", { signedByWallet: flow.isMessageSignedBy(message, signedMessage, address), message, signedMessage });
});
on("disconnect", async () => {
  await flow.disconnect();
  address = "";
  show("Disconnected", "The kit no longer holds an address.");
});

(window as unknown as { example: typeof flow }).example = flow;
document.body.dataset.ready = "true";
