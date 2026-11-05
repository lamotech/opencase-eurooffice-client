// Shared URL configuration for the OpenCase plugin.
// DEFAULT_URL is the deployment-wide default; users can override it per browser
// through the "Settings" button on the OpenCase ribbon tab.
(function (window) {
  var DEFAULT_URL = "https://dev04.opencase.dk/";
  var STORAGE_KEY = "opencase-plugin-url";
  // Login services whose session must end with Log ud in the desktop app, or
  // they sign the next user in as the previous one without asking. Also in
  // extraLogout in providers/opencase/config.json. KOMBIT's test environment.
  var LOGIN_SERVICE_URLS = [
    "https://n2adgangsstyring.eksterntest-stoettesystemerne.dk",
    "https://test-idp.kombit.dk"
  ];

  function isValidUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch (e) {
      return false;
    }
  }

  function getUrl() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && isValidUrl(stored)) return stored;
    } catch (e) {}
    return DEFAULT_URL;
  }

  function setUrl(value) {
    try {
      if (!value || value === DEFAULT_URL) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {}
  }

  window.OpenCaseSettings = {
    DEFAULT_URL: DEFAULT_URL,
    LOGIN_SERVICE_URLS: LOGIN_SERVICE_URLS,
    isValidUrl: isValidUrl,
    getUrl: getUrl,
    setUrl: setUrl
  };
})(window);
