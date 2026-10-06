import type { ApprovalRequest } from "../../src/host.ts";

const id = new URLSearchParams(location.search).get("id") ?? "";
const $ = (key: string) => document.getElementById(key)!;

function line(text: string, className = "") {
  const div = document.createElement("div");
  div.className = `line ${className}`;
  div.textContent = text;
  return div;
}

function render(request: ApprovalRequest | null) {
  const details = $("details");
  if (!request) {
    $("title").textContent = "This request expired";
    ($("ok") as HTMLButtonElement).disabled = true;
    return;
  }
  $("origin").textContent = request.origin;
  switch (request.kind) {
    case "connect":
      $("title").textContent = "Connect to this site?";
      details.append(line("It will see your address and can ask you to sign. You approve every signature."), line(request.address, "mono"));
      break;
    case "signTransaction":
      $("title").textContent = "Sign transaction";
      request.summary.operations.forEach((op) => details.append(line(op)));
      details.append(line(`Fee: ${request.summary.fee} XLM`, "muted"));
      if (request.summary.memo) details.append(line(`Memo: ${request.summary.memo}`, "muted"));
      details.append(line(request.summary.sourceIsYou ? "Account: yours" : `Built by another account (${request.summary.source.slice(0, 4)}…${request.summary.source.slice(-4)})`, "muted"));
      if (request.summary.risky) $("note").innerHTML = '<span class="warn">This transaction can change who controls your account.</span>';
      break;
    case "signAuthEntry":
      $("title").textContent = "Authorize a contract call";
      {
        const d = request.details;
        details.append(line(d.functionName ? `Call ${d.functionName}() on contract ${d.contract?.slice(0, 6)}…${d.contract?.slice(-4)}` : "Authorize a smart contract action on your behalf."));
        d.args.forEach((arg, i) => details.append(line(`Argument ${i + 1}: ${arg}`, "mono")));
        if (d.nestedCalls) details.append(line(`Also authorizes ${d.nestedCalls} nested call${d.nestedCalls === 1 ? "" : "s"}.`, "muted"));
        $("note").innerHTML = '<span class="warn">Authorizations can let a contract move your funds, for example a token transfer. Only sign what you understand.</span>';
      }
      break;
    case "signMessage":
      $("title").textContent = "Sign message";
      details.append(line(request.message, "mono"));
      $("note").textContent = "Signing proves you own this address. It can't move funds.";
      break;
    case "payment":
      $("title").textContent = `Pay ${request.amount} ${request.assetCode}`;
      details.append(line(`To ${request.to}`, "mono"));
      if (request.memo) details.append(line(`Memo: ${request.memo}`));
      if (request.createsAccount) details.append(line("This creates the recipient's Stellar account.", "muted"));
      break;
  }
}

const decide = (ok: boolean) => chrome.runtime.sendMessage({ kind: "approval-decision", id, ok }).then(() => window.close());
// The window opens wherever the user's pointer happens to be, and a page can time a request to land under a click
// that was meant for something else. Approve only arms once the request has been on screen for a moment.
const ARM_DELAY_MS = 700;
const okButton = $("ok") as HTMLButtonElement;
okButton.disabled = true;
const arm = () => setTimeout(() => (okButton.disabled = false), ARM_DELAY_MS);
if (document.visibilityState === "visible") arm();
else document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && arm(), { once: true });
okButton.addEventListener("click", () => !okButton.disabled && decide(true));
$("reject").addEventListener("click", () => decide(false));
chrome.runtime.sendMessage({ kind: "approval-details", id }).then(render);
