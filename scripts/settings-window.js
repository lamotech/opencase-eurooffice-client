(function (window) {
  var input = document.getElementById("url");
  var error = document.getElementById("error");

  window.Asc.plugin.init = function () {
    input.value = window.OpenCaseSettings.getUrl();
    input.focus();
  };

  document.getElementById("reset").addEventListener("click", function () {
    input.value = window.OpenCaseSettings.DEFAULT_URL;
    error.classList.remove("visible");
  });

  input.addEventListener("input", function () {
    error.classList.remove("visible");
  });

  // Sent by the main plugin when the user clicks Save.
  window.Asc.plugin.attachEvent("onSave", function () {
    var url = input.value.trim();
    if (!window.OpenCaseSettings.isValidUrl(url)) {
      error.classList.add("visible");
      return;
    }
    window.Asc.plugin.sendToPlugin("onSettingsSave", { url: url });
  });
})(window);
