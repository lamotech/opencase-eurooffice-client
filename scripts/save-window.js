// "Gem i OpenCase": creates a document on a case (POST /documents) and uploads
// the file that is open in the editor (POST /documents/{id}/files). The main
// plugin then opens the server copy and closes the local file.
(function (window) {
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
  var status = $("status");

  var localFile = null;      // { path, name, ext } of the file open in the editor
  var saving = false;

  // Info and Afsendere/modtagere: see scripts/document-form.js.
  var documentForm = window.OpenCaseDocumentForm.create(form, {
    idPrefix: "save-",
    submitLabel: "Gem",
    showStatus: showStatus,
    onNotLoggedIn: function (message) { showLogin(message); }
  });

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

  // --- Saving -------------------------------------------------------------------

  async function save() {
    if (saving) return;
    if (!localFile) {
      showStatus(fileInfo.textContent, true);
      return;
    }
    if (!documentForm.validate()) {
      showStatus("Udfyld de påkrævede felter.", true);
      return;
    }
    saving = true;
    documentForm.setBusy(true);
    var createdDocument;
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

      // Once; a retry reuses the document and adds only the missing contacts.
      createdDocument = await documentForm.createDocument();

      showStatus("Uploader " + localFile.name + "...");
      var formData = new FormData();
      formData.append("file", blob, localFile.name);
      var file = await window.OpenCaseApi.post("/documents/" + encodeURIComponent(createdDocument.id) + "/files", { form: formData });

      showStatus("Gemt som " + (createdDocument.documentnumber || "nyt dokument") + ". Åbner filen fra OpenCase...");
      window.Asc.plugin.sendToPlugin("onSavedInOpenCase", { document: createdDocument, file: file });
    } catch (error) {
      if (error instanceof window.OpenCaseApi.NotLoggedInError) {
        showLogin(error.message);
      } else if (error.contactProblem) {
        showStatus(error.message + " Filen er ikke uploadet endnu.", true);
      } else if (documentForm.createdDocument()) {
        createdDocument = documentForm.createdDocument();
        showStatus("Dokumentet " + (createdDocument.documentnumber || "") +
          " er oprettet, men filen blev ikke uploadet: " + error.message + " Tryk Gem for at prøve igen.", true);
      } else {
        showStatus("FEJL: " + error.message, true);
      }
    } finally {
      saving = false;
      documentForm.setBusy(false);
    }
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
      documentForm.setTitle(file.baseName, true);
    }

    showStatus("Henter lister...");
    try {
      await documentForm.loadLists();
      showStatus("");
      if (localFile) documentForm.focus();
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
    documentForm.loadLists().catch(function (error) {
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
