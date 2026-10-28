// Shared by the send dialogs (Digital Post, link and PDF by email).
// Requires scripts/api.js.
(function (window) {
  var status = document.getElementById("status");

  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function button(text, className, onClick) {
    var b = element("button", className || "button", text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  function showStatus(message, problem) {
    status.replaceChildren(document.createTextNode(message || ""));
    status.classList.toggle("problem", !!problem);
  }

  function showLogin(message) {
    showStatus(message + " (" + window.OpenCaseSettings.getUrl() + ")", true);
    var login = button("Log ind", "button primary", function () {
      login.remove();
      showStatus("Log ind i browseren, og giv adgang. Venter...");
      window.Asc.plugin.sendToPlugin("onLogin", null);
    });
    status.appendChild(document.createElement("br"));
    status.appendChild(login);
  }

  function reportError(error) {
    if (error instanceof window.OpenCaseApi.NotLoggedInError) {
      showLogin(error.message);
    } else if (error.status === 404) {
      showStatus("Dokumentet findes ikke, eller du har ikke adgang til det.", true);
    } else {
      showStatus("FEJL: " + error.message, true);
    }
  }

  // As OpenCase: the first six digits, then XXXX.
  function maskCpr(cpr) {
    var digits = String(cpr || "").replace(/\D/g, "");
    return digits.length >= 6 ? digits.slice(0, 6) + "XXXX" : cpr;
  }

  function formatDateTime(value) {
    if (!value) return "";
    var date = new Date(value);
    if (isNaN(date)) return value;
    return date.toLocaleString("da-DK", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // The document of the open file: the send endpoints take its id.
  function loadDocument(fileId) {
    return window.OpenCaseApi.get("/files/" + encodeURIComponent(fileId) + "/document");
  }

  // Fetches a file with the login and hands it to the browser as a download.
  async function download(path, name) {
    var blob = await window.OpenCaseApi.getBlob(path);
    var url = URL.createObjectURL(blob);
    var link = element("a");
    link.href = url;
    link.download = name || "dokument.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  window.OpenCaseSend = {
    element: element,
    button: button,
    showStatus: showStatus,
    showLogin: showLogin,
    reportError: reportError,
    maskCpr: maskCpr,
    formatDateTime: formatDateTime,
    loadDocument: loadDocument,
    download: download
  };
})(window);
