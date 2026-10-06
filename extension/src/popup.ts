import { loadAccount, fundWithFriendbot } from "../../src/core/horizon.ts";
import type { NetworkConfig } from "../../src/core/network.ts";

type State = { address: string; allowed: string[]; freighterCompat: boolean; network: NetworkConfig };
const $ = (id: string) => document.getElementById(id)!;
const send = <T,>(message: object) => chrome.runtime.sendMessage(message) as Promise<T>;

async function render() {
  const state = await send<State>({ kind: "wallet-state" });
  $("address").textContent = state.address;
  ($("compat") as HTMLInputElement).checked = state.freighterCompat;
  const list = $("sites");
  list.innerHTML = "";
  if (!state.allowed.length) list.innerHTML = '<li class="muted">None yet</li>';
  for (const origin of state.allowed) {
    const li = document.createElement("li");
    li.innerHTML = '<span class="mono"></span><button>Forget</button>';
    li.querySelector("span")!.textContent = origin;
    li.querySelector("button")!.onclick = () => send({ kind: "forget-site", origin }).then(render);
    list.append(li);
  }
  const account = await loadAccount(state.network, state.address).catch(() => null);
  const xlm = account?.exists ? account.balances.find((b) => b.asset.isNative())?.balance : null;
  $("balance").textContent = account === null ? "Offline" : account.exists ? `${Number(xlm).toLocaleString()} XLM` : "Not funded";
  ($("fund") as HTMLButtonElement).hidden = !!account?.exists;
  $("copy").onclick = () => navigator.clipboard.writeText(state.address);
  $("fund").onclick = async () => {
    $("balance").textContent = "Funding…";
    await fundWithFriendbot(state.network, state.address).catch(() => undefined);
    render();
  };
}

$("compat").addEventListener("change", (event) => {
  send({ kind: "set-freighter-compat", value: (event.target as HTMLInputElement).checked });
});
render();
