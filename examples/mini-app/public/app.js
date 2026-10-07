(function () {
  var $ = function (id) { return document.getElementById(id); };
  var mini = window.mini;
  // MiniGo is on testnet, so this is the wrong network.
  var PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

  function log(kind, text) {
    var item = document.createElement("li");
    item.className = kind;
    var time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    item.innerHTML = "<time></time><span></span>";
    item.firstChild.textContent = time;
    item.lastChild.textContent = text;
    $("log").prepend(item);
  }

  // Every call resolves, with its result or with { error: { code, message } }. -3 is a bad request, -4 a decline.
  function describeError(error) {
    var detail = error.ext && error.ext.length ? " (" + error.ext.join("; ") + ")" : "";
    return (error.code === -4 ? "Declined in MiniGo." : error.message) + detail + " [" + error.code + "]";
  }

  var lastError = "";
  function run(label, promise) {
    log("call", label);
    lastError = "";
    return promise.then(function (result) {
      if (result && result.error) {
        lastError = describeError(result.error);
        log("error", label + " failed: " + lastError);
        return null;
      }
      log("ok", label + ": " + JSON.stringify(result));
      return result;
    });
  }

  if (!mini) {
    $("env").textContent = "Not in MiniGo";
    $("env").classList.add("warn");
    log("error", "window.mini is missing. Open this page from MiniGo under Profile > Developer.");
    document.querySelectorAll("button, input, select").forEach(function (el) { el.disabled = el.id === "clear" ? false : true; });
  } else {
    $("env").textContent = "Inside MiniGo";
    $("env").classList.add("ok");
    log("ok", "window.mini found (provider " + mini.version + ")");
  }

  $("connect").addEventListener("click", function () {
    run("requestAccess()", mini.requestAccess()).then(function (result) {
      if (!result) return;
      $("wallet-state").textContent = "Connected";
      $("wallet-state").classList.add("ok");
      $("address-out").textContent = result.address;
    });
  });

  $("address").addEventListener("click", function () {
    run("getAddress()", mini.getAddress()).then(function (result) {
      if (result) $("address-out").textContent = result.address;
    });
  });

  $("network").addEventListener("click", function () {
    run("getNetwork()", mini.getNetwork()).then(function (result) {
      if (result) $("network-out").textContent = result.network + ", " + result.networkPassphrase;
    });
  });

  $("pay-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var payment = { to: $("to").value.trim(), amount: $("amount").value.trim(), asset: $("asset").value };
    if ($("memo").value.trim()) payment.memo = $("memo").value.trim();
    $("pay-out").textContent = "Waiting for MiniGo. Approve in the wallet; it can take a few seconds.";
    run("requestPayment(" + payment.amount + " " + payment.asset + ")", mini.requestPayment(payment)).then(function (result) {
      $("pay-out").textContent = result ? "Paid: https://stellar.expert/explorer/testnet/tx/" + result.hash : "Not paid: " + lastError;
    });
  });

  $("sign-form").addEventListener("submit", function (event) {
    event.preventDefault();
    run("signMessage()", mini.signMessage($("message").value)).then(function (result) {
      $("sign-out").textContent = result ? result.signerAddress + "\n" + result.signedMessage : "Not signed: " + lastError;
    });
  });

  var cases = {
    "bad-address": function () { return mini.requestPayment({ to: "GNOTAREALADDRESS", amount: "1" }); },
    zero: function () { return mini.requestPayment({ to: $("to").value.trim(), amount: "0" }); },
    "bad-asset": function () { return mini.requestPayment({ to: $("to").value.trim(), amount: "1", asset: "EURC" }); },
    "wrong-network": function () { return mini.signMessage("hello", { networkPassphrase: PUBLIC_PASSPHRASE }); },
  };
  document.querySelectorAll("[data-case]").forEach(function (button) {
    button.addEventListener("click", function () {
      run(button.textContent, cases[button.dataset.case]());
    });
  });

  $("clear").addEventListener("click", function () { $("log").innerHTML = ""; });
})();
