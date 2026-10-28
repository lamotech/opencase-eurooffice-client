// Requests to the OpenCase desktop API with the stored app password.
// Requires scripts/settings.js and scripts/auth.js.
(function (window) {
  class NotLoggedInError extends Error {}

  // A window may not see the login the main plugin got (when localStorage is
  // blocked or not shared), so it asks the main plugin for it.
  var authWaiters = [];

  window.Asc.plugin.attachEvent("onAuth", function (credentials) {
    window.OpenCaseAuth.adopt(credentials);
    var waiters = authWaiters;
    authWaiters = [];
    waiters.forEach(function (resolve) { resolve(); });
  });

  function requestAuthFromMainPlugin() {
    return new Promise(function (resolve) {
      authWaiters.push(resolve);
      setTimeout(resolve, 2000); // no answer: carry on as logged out
      window.Asc.plugin.sendToPlugin("onAuthRequest", null);
    });
  }

  // Rejects with NotLoggedInError when there is no login or the server rejects
  // it (after telling the main plugin, so the ribbon shows "Log ind" again).
  // options: { params: query parameters, json: JSON body, form: FormData body,
  //            blob: resolve with the response body as a Blob }
  async function request(method, path, options) {
    options = options || {};
    if (!window.OpenCaseAuth.isLoggedIn()) {
      await requestAuthFromMainPlugin();
    }
    if (!window.OpenCaseAuth.isLoggedIn()) {
      throw new NotLoggedInError("Du er ikke logget ind på OpenCase");
    }

    var url = window.OpenCaseAuth.apiUrl(path);
    var query = new URLSearchParams();
    Object.keys(options.params || {}).forEach(function (key) {
      var value = options.params[key];
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    if (query.toString()) url += "?" + query.toString();

    var headers = Object.assign({ Accept: options.blob ? "*/*" : "application/json" }, window.OpenCaseAuth.authHeaders());
    var body;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form; // the browser sets the multipart boundary
    }

    var response;
    try {
      // Never send the browser's Nextcloud session cookie: on #[CORS] routes
      // Nextcloud logs that session out when it comes along (CSRF protection),
      // which would log the user out of OpenCase documents open in the editor.
      response = await fetch(url, { method: method, headers: headers, body: body, credentials: "omit" });
    } catch (error) {
      throw new Error("Kunne ikke kontakte " + url + " (" + error.message + ")");
    }

    if (response.status === 401) {
      window.Asc.plugin.sendToPlugin("onLoggedOut", null);
      throw new NotLoggedInError("Dit login er udløbet. Log ind igen.");
    }
    if (!response.ok) {
      var error = new Error((await errorMessage(response)) || ("Serveren svarede " + response.status + " for " + url));
      error.status = response.status;
      throw error;
    }
    if (options.blob) return response.blob();
    // DELETE and some PUTs may answer 204 without a body.
    var text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  // Nextcloud errors are usually { "message": "…" }; OpenCase's own are
  // { "error": "…" }, written to be shown as they are.
  async function errorMessage(response) {
    try {
      var data = await response.json();
      if (data && typeof data.error === "string") return data.error;
      if (data && data.message) return data.message + " (HTTP " + response.status + ")";
    } catch (e) {}
    return null;
  }

  function get(path, params) {
    return request("GET", path, { params: params });
  }

  function post(path, options) {
    return request("POST", path, options);
  }

  // A file, e.g. a PDF. A plain link can't be used: it would need the login.
  function getBlob(path) {
    return request("GET", path, { blob: true });
  }

  function put(path, options) {
    return request("PUT", path, options);
  }

  function del(path) {
    return request("DELETE", path, {});
  }

  window.OpenCaseApi = {
    get: get,
    post: post,
    getBlob: getBlob,
    put: put,
    del: del,
    NotLoggedInError: NotLoggedInError
  };
})(window);
