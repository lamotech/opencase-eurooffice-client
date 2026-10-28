// "Gem i OpenCase": creates a document on a case (POST /documents) and uploads
// the file that is open in the editor (POST /documents/{id}/files). The main
// plugin then opens the server copy and closes the local file.
(function (window) {
  var CASE_SEARCH_DELAY_MS = 300; // as the case picker in the Files app
  var MIME_TYPES = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    pdf: "application/pdf",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation"
  };

  var $ = function (id) { return document.getElementById(id); };
  var form = $("form");
  var fileInfo = $("file-info");
  var caseSearch = $("case-search");
  var caseResults = $("case-results");
  var selectedCaseBox = $("selected-case");
  var titleInput = $("title");
  var category = $("category");
  var documentType = $("document-type");
  var insightLevel = $("insight-level");
  var insightLevelHint = $("insight-level-hint");
  var documentDate = $("document-date");
  var receivedDate = $("received-date");
  var registeredDate = $("registered-date");
  var summary = $("summary");
  var status = $("status");

  var localFile = null;      // { path, name, ext } of the file open in the editor
  var selectedCase = null;
  var caseOptions = [];      // cases shown in the dropdown
  var activeOption = -1;
  var caseTimer = null;
  var caseSearchId = 0;
  var insightLevels = [];
  var createdDocument = null; // kept so a failed upload can be retried without a second document
  var saving = false;

  function showStatus(message, problem) {
    status.textContent = message;
    status.classList.toggle("problem", !!problem);
  }

  // The LocalFile* functions answer for the frame they are called from, and
  // the plugin window's own frame has no file (empty path). Use the editor's
  // frame, which is the parent; fall back to our own object if it is blocked.
  function desktop() {
    try {
      if (window.parent && window.parent !== window && window.parent.AscDesktopEditor) {
        return window.parent.AscDesktopEditor;
      }
    } catch (e) {}
    return window.AscDesktopEditor || null;
  }

  // --- The file open in the editor ---------------------------------------

  // The editor API lives in the parent frame; reaching it may be blocked.
  function editorApi() {
    try {
      return (window.parent.Asc && window.parent.Asc.editor) || window.parent.editor || null;
    } catch (e) {
      return null;
    }
  }

  function splitName(name) {
    var dot = name.lastIndexOf(".");
    return {
      name: name,
      ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
      baseName: dot > 0 ? name.slice(0, dot) : name
    };
  }

  // Describes the file open in the editor. needsFirstSave: a new document that
  // has never been written to disk, so the upload has nothing to read yet.
  function inspectLocalFile() {
    var app = desktop();
    if (!app || typeof app.LocalFileGetSourcePath !== "function") {
      return { problem: "Gem i OpenCase virker kun i Euro-Office desktop." };
    }
    if (typeof app.IsLocalFile === "function" && !app.IsLocalFile()) {
      return { problem: "Dokumentet er ikke en lokal fil. Det er allerede gemt på en server." };
    }
    var path = app.LocalFileGetSourcePath() || "";
    var saved = typeof app.LocalFileGetSaved !== "function" || app.LocalFileGetSaved();
    if (path && saved) {
      return Object.assign({ path: path, needsFirstSave: false }, splitName(path.split(/[\\/]/).pop()));
    }

    var api = editorApi();
    if (!api) {
      return { problem: "Gem dokumentet på din computer først (Ctrl+S), og åbn så Gem i OpenCase igen." };
    }
    return Object.assign({ path: "", needsFirstSave: true }, splitName(api.documentTitle || "Dokument.docx"));
  }

  function hasUnsavedChanges() {
    var api = editorApi();
    try {
      if (api && typeof api.isDocumentModified === "function") return api.isDocumentModified();
      if (api && typeof api.asc_isDocumentModified === "function") return api.asc_isDocumentModified();
    } catch (e) {}
    return false;
  }

  // Saves the document to disk as Ctrl+S does (Save As for a new document),
  // because the upload reads the file from disk. The desktop app can only save
  // to a path the user picks, so a new document gets the normal save dialog.
  // Resolves when the desktop app reports the save as finished.
  function saveToDisk(isSaveAs) {
    var api = editorApi();
    var parent = window.parent;
    if (!api || typeof api.asc_Save !== "function" || typeof parent.DesktopOfflineAppDocumentEndSave !== "function") {
      return Promise.reject(new Error("Dokumentet kunne ikke gemmes automatisk. Gem det (Ctrl+S), og prøv igen."));
    }

    return new Promise(function (resolve, reject) {
      // The desktop app calls this when a save ends, also when the user
      // cancels the save dialog (error is then not 0).
      var original = parent.DesktopOfflineAppDocumentEndSave;
      parent.DesktopOfflineAppDocumentEndSave = function (error) {
        parent.DesktopOfflineAppDocumentEndSave = original;
        var result = original.apply(this, arguments);
        // The editor itself compares loosely (error == 0).
        if (Number(error) === 0) {
          resolve();
        } else {
          reject(new Error("Dokumentet blev ikke gemt på din computer."));
        }
        return result;
      };

      try {
        api.asc_Save(false, isSaveAs === true);
      } catch (error) {
        parent.DesktopOfflineAppDocumentEndSave = original;
        reject(error);
      }
    });
  }

  function fileUrl(path) {
    var parts = path.replace(/\\/g, "/").split("/").map(function (part, index) {
      // Keep the drive letter ("C:") as it is.
      return index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part);
    });
    return "file:///" + parts.join("/").replace(/^\/+/, "");
  }

  // fetch() does not support file: URLs; XHR does in the desktop app.
  function readLocalFile(file) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", fileUrl(file.path));
      xhr.responseType = "blob";
      xhr.onload = function () {
        // file: requests report status 0 on success.
        if ((xhr.status === 0 || xhr.status === 200) && xhr.response && xhr.response.size) {
          resolve(new Blob([xhr.response], { type: MIME_TYPES[file.ext] || "application/octet-stream" }));
        } else {
          reject(new Error("Filen kunne ikke læses: " + file.path));
        }
      };
      xhr.onerror = function () {
        reject(new Error("Filen kunne ikke læses: " + file.path));
      };
      xhr.send();
    });
  }

  // --- Lists ----------------------------------------------------------------

  async function loadLists() {
    var results = await Promise.all([
      window.OpenCaseApi.get("/document-categories"),
      window.OpenCaseApi.get("/document-types"),
      window.OpenCaseApi.get("/insight-levels")
    ]);
    fillSelect(category, results[0], function (item) { return item.id; });
    // The document type is sent by name.
    fillSelect(documentType, results[1], function (item) { return item.name; });
    insightLevels = results[2] || [];
    fillSelect(insightLevel, insightLevels, function (item) { return item.id; });
  }

  function fillSelect(select, items, valueOf) {
    // Keep the first, empty option.
    while (select.options.length > 1) select.remove(1);
    (items || []).forEach(function (item) {
      var option = new Option(item.name, String(valueOf(item)));
      if (item.description) option.title = item.description;
      select.add(option);
    });
  }

  insightLevel.addEventListener("change", function () {
    var level = insightLevels.find(function (item) { return String(item.id) === insightLevel.value; });
    insightLevelHint.textContent = level && level.description ? level.description : "";
  });

  // --- Case picker -------------------------------------------------------------

  function caseLabel(c) {
    return [c.caseNumber, c.title].filter(Boolean).join(" — ");
  }

  caseSearch.addEventListener("input", function () {
    clearError("case");
    clearTimeout(caseTimer);
    var text = caseSearch.value.trim();
    if (!text) {
      closeCaseResults();
      return;
    }
    caseTimer = setTimeout(function () { searchCases(text); }, CASE_SEARCH_DELAY_MS);
  });

  caseSearch.addEventListener("keydown", function (event) {
    if (caseResults.hidden) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveOption(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeOption >= 0) pickCase(caseOptions[activeOption]);
    } else if (event.key === "Escape") {
      closeCaseResults();
    }
  });

  caseSearch.addEventListener("blur", function () {
    // Let a click on an option land first.
    setTimeout(closeCaseResults, 150);
  });

  async function searchCases(text) {
    var id = ++caseSearchId;
    showCaseMessage("Søger...");
    try {
      var cases = await window.OpenCaseApi.get("/cases", { search: text });
      if (id !== caseSearchId) return;
      renderCaseResults(cases || []);
    } catch (error) {
      if (id !== caseSearchId) return;
      if (error instanceof window.OpenCaseApi.NotLoggedInError) {
        closeCaseResults();
        showLogin(error.message);
      } else {
        showCaseMessage("FEJL: " + error.message);
      }
    }
  }

  function showCaseMessage(message) {
    caseOptions = [];
    activeOption = -1;
    var li = document.createElement("li");
    li.className = "case-message";
    li.textContent = message;
    caseResults.replaceChildren(li);
    openCaseResults();
  }

  function renderCaseResults(cases) {
    if (!cases.length) {
      showCaseMessage("Ingen sager fundet");
      return;
    }
    caseOptions = cases;
    activeOption = -1;
    caseResults.replaceChildren();
    cases.forEach(function (c, index) {
      var li = document.createElement("li");
      li.className = "case-option";
      li.id = "case-option-" + index;
      li.setAttribute("role", "option");
      li.textContent = caseLabel(c);

      var sub = document.createElement("div");
      sub.className = "sub";
      var details = [c.organisation, c.status];
      if (!c.canWrite) details.push("ingen skriveadgang");
      sub.textContent = details.filter(Boolean).join(" · ");
      li.appendChild(sub);

      if (!c.canWrite) {
        li.setAttribute("aria-disabled", "true");
      } else {
        // mousedown, so it fires before the input's blur closes the list.
        li.addEventListener("mousedown", function (event) {
          event.preventDefault();
          pickCase(c);
        });
      }
      caseResults.appendChild(li);
    });
    openCaseResults();
  }

  function moveActiveOption(step) {
    if (!caseOptions.length) return;
    var index = activeOption;
    // Skip cases without write access.
    for (var i = 0; i < caseOptions.length; i++) {
      index = (index + step + caseOptions.length) % caseOptions.length;
      if (caseOptions[index].canWrite) break;
    }
    if (!caseOptions[index].canWrite) return;
    activeOption = index;
    Array.prototype.forEach.call(caseResults.children, function (li, i) {
      li.classList.toggle("active", i === index);
    });
    var active = $("case-option-" + index);
    caseSearch.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  }

  function openCaseResults() {
    caseResults.hidden = false;
    caseSearch.setAttribute("aria-expanded", "true");
  }

  function closeCaseResults() {
    caseResults.hidden = true;
    caseSearch.setAttribute("aria-expanded", "false");
    caseSearch.removeAttribute("aria-activedescendant");
  }

  function pickCase(c) {
    if (!c || !c.canWrite) return;
    selectedCase = c;
    $("selected-case-text").textContent = caseLabel(c);
    selectedCaseBox.hidden = false;
    caseSearch.hidden = true;
    closeCaseResults();
    clearError("case");
  }

  $("change-case").addEventListener("click", function () {
    selectedCase = null;
    selectedCaseBox.hidden = true;
    caseSearch.hidden = false;
    caseSearch.value = "";
    caseSearch.focus();
  });

  // --- Rich text summary -------------------------------------------------------

  document.querySelectorAll(".toolbar button").forEach(function (button) {
    // mousedown keeps the selection in the editor.
    button.addEventListener("mousedown", function (event) {
      event.preventDefault();
    });
    button.addEventListener("click", function () {
      summary.focus();
      document.execCommand(button.dataset.command, false, null);
    });
  });

  function summaryHtml() {
    var empty = !summary.textContent.trim() && !summary.querySelector("img, li");
    return empty ? null : summary.innerHTML;
  }

  // --- Validation and saving ---------------------------------------------------

  function setError(field, message) {
    $(field + "-error").textContent = message;
    var input = field === "case" ? caseSearch : field === "title" ? titleInput : category;
    input.classList.add("invalid");
  }

  function clearError(field) {
    $(field + "-error").textContent = "";
    var input = field === "case" ? caseSearch : field === "title" ? titleInput : category;
    input.classList.remove("invalid");
  }

  titleInput.addEventListener("input", function () { clearError("title"); });
  category.addEventListener("change", function () { clearError("category"); });

  function validate() {
    var firstInvalid = null;
    if (!selectedCase) {
      setError("case", "Vælg en sag.");
      firstInvalid = firstInvalid || caseSearch;
    }
    if (!titleInput.value.trim()) {
      setError("title", "Skriv en titel.");
      firstInvalid = firstInvalid || titleInput;
    }
    if (!category.value) {
      setError("category", "Vælg en dokumentkategori.");
      firstInvalid = firstInvalid || category;
    }
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  function documentBody() {
    var body = {
      caseId: selectedCase.id,
      title: titleInput.value.trim(),
      documentCategoryId: Number(category.value)
    };
    if (documentType.value) body.documentType = documentType.value;
    // Left out, the server uses the case's insight level.
    if (insightLevel.value) body.insightLevelId = Number(insightLevel.value);
    if (documentDate.value) body.documentDate = documentDate.value;
    if (receivedDate.value) body.receivedDate = receivedDate.value;
    if (registeredDate.value) body.registeredDate = registeredDate.value;
    var html = summaryHtml();
    if (html) body.summary = html;
    return body;
  }

  async function save() {
    if (saving) return;
    if (!localFile) {
      showStatus(fileInfo.textContent, true);
      return;
    }
    if (!createdDocument && !validate()) {
      showStatus("Udfyld de påkrævede felter.", true);
      return;
    }
    saving = true;
    try {
      // The upload reads the file from disk, so unsaved changes are saved first.
      if (localFile.needsFirstSave || hasUnsavedChanges()) {
        showStatus(localFile.needsFirstSave
          ? "Vælg, hvor dokumentet skal gemmes på din computer..."
          : "Gemmer ændringerne på din computer...");
        await saveToDisk(localFile.needsFirstSave);
        var saved = inspectLocalFile();
        if (saved.problem || saved.needsFirstSave) {
          throw new Error(saved.problem ||
            "Dokumentet er gemt, men pluginet kan ikke se, hvor filen ligger. Luk og åbn filen, og prøv igen.");
        }
        localFile = saved;
      }

      showStatus("Læser filen...");
      var blob = await readLocalFile(localFile);

      if (!createdDocument) {
        showStatus("Opretter dokumentet i OpenCase...");
        createdDocument = await window.OpenCaseApi.post("/documents", { json: documentBody() });
        setFormLocked(true);
      }

      showStatus("Uploader " + localFile.name + "...");
      var formData = new FormData();
      formData.append("file", blob, localFile.name);
      var file = await window.OpenCaseApi.post("/documents/" + encodeURIComponent(createdDocument.id) + "/files", { form: formData });

      showStatus("Gemt som " + (createdDocument.documentnumber || "nyt dokument") + ". Åbner filen fra OpenCase...");
      window.Asc.plugin.sendToPlugin("onSavedInOpenCase", { document: createdDocument, file: file });
    } catch (error) {
      if (error instanceof window.OpenCaseApi.NotLoggedInError) {
        showLogin(error.message);
      } else if (createdDocument) {
        showStatus("Dokumentet " + (createdDocument.documentnumber || "") +
          " er oprettet, men filen blev ikke uploadet: " + error.message + " Tryk Gem for at prøve igen.", true);
      } else {
        showStatus("FEJL: " + error.message, true);
      }
    } finally {
      saving = false;
    }
  }

  // After the document exists, only the upload can be retried.
  function setFormLocked(locked) {
    form.querySelectorAll("input, select, button").forEach(function (el) {
      el.disabled = locked;
    });
    summary.contentEditable = locked ? "false" : "true";
  }

  function showLogin(message) {
    showStatus(message + " (" + window.OpenCaseSettings.getUrl() + ")", true);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "login";
    button.textContent = "Log ind";
    button.addEventListener("click", function () {
      button.remove();
      showStatus("Log ind i browseren, og giv adgang. Venter...");
      window.Asc.plugin.sendToPlugin("onLogin", null);
    });
    status.appendChild(document.createElement("br"));
    status.appendChild(button);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
  });

  // --- Start -----------------------------------------------------------------

  function today() {
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  }

  async function start() {
    var file = inspectLocalFile();
    if (file.problem) {
      fileInfo.textContent = file.problem;
      fileInfo.classList.add("problem");
    } else {
      localFile = file;
      fileInfo.textContent = (file.needsFirstSave
          ? "Dokumentet er ikke gemt endnu. Når du trykker Gem, skal du først vælge, hvor det gemmes på din computer. "
          : "Filen " + file.name + " gemmes på et nyt dokument i OpenCase. Ændringer, der ikke er gemt, gemmes først. ") +
        "Derefter åbnes kopien fra OpenCase, og den lokale fil lukkes.";
      titleInput.value = file.baseName;
    }
    documentDate.value = today();

    showStatus("Henter lister...");
    try {
      await loadLists();
      showStatus("");
      if (localFile) caseSearch.focus();
    } catch (error) {
      if (error instanceof window.OpenCaseApi.NotLoggedInError) {
        showLogin(error.message);
      } else {
        showStatus("FEJL: " + error.message, true);
      }
    }
  }

  window.Asc.plugin.init = function () {
    start();
  };

  // Sent by the main plugin when the user clicks Gem.
  window.Asc.plugin.attachEvent("onSave", function () {
    save();
  });

  window.Asc.plugin.attachEvent("onLoggedIn", function () {
    showStatus("Du er logget ind.");
    loadLists().catch(function (error) {
      showStatus("FEJL: " + error.message, true);
    });
  });

  window.Asc.plugin.attachEvent("onLoginFailed", function (data) {
    showLogin("Login fejlede: " + (data && data.error));
  });

  // Result of opening the server copy, from the main plugin.
  window.Asc.plugin.attachEvent("onDesktopApiTest", function (data) {
    if (data && data.commandExecuted === false) {
      showStatus("Filen er gemt i OpenCase, men kunne ikke åbnes: " + data.error, true);
    }
  });
})(window);
