// Shared URL configuration for the OpenCase plugin.
// DEFAULT_URL is the deployment-wide default; users can override it per browser
// through the "Settings" button on the OpenCase ribbon tab.
(function (window) {
  var DEFAULT_URL = "https://dev04.opencase.dk/";
  var STORAGE_KEY = "opencase-plugin-url";

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
    isValidUrl: isValidUrl,
    getUrl: getUrl,
    setUrl: setUrl
  };
})(window);
