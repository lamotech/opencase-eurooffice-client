// Login against the OpenCase backend via Nextcloud Login Flow v2.
// The user logs in in the browser with whatever scheme the customer uses
// (Nextcloud password, Entra ID/OIDC, KOMBIT SAML); the plugin only receives
// an app password, which it sends as Basic auth on every API call.
// Requires scripts/settings.js.
(function (window) {
  var API_PATH = "/index.php/apps/opencase/desktop/v1/api";
  var STORAGE_PREFIX = "opencase-plugin-auth:";
  var POLL_INTERVAL_MS = 2000;
  // Nextcloud discards login flow tokens after 20 minutes.
  var POLL_TIMEOUT_MS = 20 * 60 * 1000;

  function serverUrl() {
    return window.OpenCaseSettings.getUrl().replace(/\/$/, "");
  }

  function apiUrl(path) {
    return serverUrl() + API_PATH + path;
  }

  // Credentials are kept per server, so changing the URL in Settings
  // never sends one customer's app password to another server.
  function storageKey() {
    return STORAGE_PREFIX + serverUrl();
  }

  // Fallback when localStorage is blocked or not shared with the plugin's
  // windows (seen in editors served by the Document Server). Lives as long
  // as this frame; windows get it from the main plugin (see api.js).
  var memory = {};

  function get() {
    try {
      var stored = JSON.parse(window.localStorage.getItem(storageKey()));
      if (stored && stored.loginName && stored.appPassword) return stored;
    } catch (e) {}
    return memory[storageKey()] || null;
  }

  function set(credentials) {
    var value = {
      loginName: credentials.loginName,
      appPassword: credentials.appPassword
    };
    memory[storageKey()] = value;
    try {
      window.localStorage.setItem(storageKey(), JSON.stringify(value));
    } catch (e) {
      console.warn("OpenCase: localStorage is not available, the login is kept in memory only.", e);
    }
  }

  // Takes over credentials from the main plugin, without writing them to storage.
  function adopt(credentials) {
    if (credentials && credentials.loginName && credentials.appPassword) {
      memory[storageKey()] = { loginName: credentials.loginName, appPassword: credentials.appPassword };
    }
  }

  function clear() {
    delete memory[storageKey()];
    try {
      window.localStorage.removeItem(storageKey());
    } catch (e) {}
  }

  function isLoggedIn() {
    return get() !== null;
  }

  function authHeaders() {
    var credentials = get();
    if (!credentials) return {};
    // btoa only handles Latin-1; encode the UTF-8 bytes first.
    var raw = credentials.loginName + ":" + credentials.appPassword;
    var basic = window.btoa(unescape(encodeURIComponent(raw)));
    return { Authorization: "Basic " + basic };
  }

  // Simple CORS requests only (no custom headers), so no preflight is needed.
  // No cookies, for the same reason as in api.js: Nextcloud would log out the
  // session they belong to.
  function postForm(url, fields) {
    var body = new URLSearchParams(fields || {});
    return fetch(url, { method: "POST", body: body, credentials: "omit" });
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Starts the login flow: calls openLoginPage(url) so the user can log in
  // in the browser, then polls until the app password is granted.
  // Resolves with { loginName, appPassword }.
  async function login(openLoginPage) {
    var init = await postForm(apiUrl("/login"));
    if (!init.ok) throw new Error("Login kunne ikke startes (HTTP " + init.status + ")");
    var flow = await init.json();
    if (!flow.login || !flow.poll || !flow.poll.token || !flow.poll.endpoint) {
      throw new Error("Uventet svar fra serveren ved login");
    }

    openLoginPage(flow.login);

    var deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(POLL_INTERVAL_MS);
      var poll;
      try {
        poll = await postForm(flow.poll.endpoint, { token: flow.poll.token });
      } catch (e) {
        continue; // transient network error; keep polling
      }
      // 404 means the user has not granted access yet.
      if (poll.status === 404) continue;
      if (!poll.ok) throw new Error("Login fejlede (HTTP " + poll.status + ")");

      var credentials = await poll.json();
      if (!credentials.loginName || !credentials.appPassword) {
        throw new Error("Uventet svar fra serveren ved login");
      }
      set(credentials);
      return credentials;
    }
    throw new Error("Login udløb. Prøv igen.");
  }

  // Forgets the app password locally and asks the server to revoke it.
  async function logout() {
    var headers = authHeaders();
    clear();
    if (!headers.Authorization) return;
    try {
      await fetch(apiUrl("/logout"), { method: "POST", headers: headers, credentials: "omit" });
    } catch (e) {}
  }

  window.OpenCaseAuth = {
    apiUrl: apiUrl,
    authHeaders: authHeaders,
    isLoggedIn: isLoggedIn,
    get: get,
    adopt: adopt,
    clear: clear,
    login: login,
    logout: logout
  };
})(window);
