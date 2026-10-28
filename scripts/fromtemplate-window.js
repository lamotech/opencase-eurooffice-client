// "Ny fil fra skabelon": creates a file on a document from a template, as the
// dialog of the same name in OpenCase does. The server fills in the merge
// fields and inserts the chosen phrases (POST /documents/{id}/files/from-template);
// the main plugin then opens the new file.
(function (window) {
  var SEARCH_DELAY_MS = 300;
  var LISTS = ["recent", "favorites", "my-documents"];

  var $ = function (id) { return document.getElementById(id); };
  var form = $("form");
  var documentSearch = $("document-search");
  var documentsList = $("documents");
  var caseSearch = $("case-search");
  var casesList = $("cases");
  var docTitle = $("doc-title");
  var category = $("category");
  var targetHint = $("target-hint");
  var templateSearch = $("template-search");
  var templatesList = $("templates");
  var filenameInput = $("filename");
  var filenameHint = $("filename-hint");
  var phrasesList = $("phrases");
  var createButton = $("create");
  var status = $("status");

  var openFileId = null;     // from the main plugin, for a document opened from OpenCase
  var currentDocument = null; // GET /files/{fileId}/document of the open file
  var listDocuments = null;  // recent, favorites and my documents, merged
  var pickedDocument = null;
  var pickedCase = null;
  var templates = [];
  var pickedTemplate = null;
  var phrases = [];
  var contextKey = null;     // the context templates and phrases were loaded for
  var filenameTouched = false; // the user typed their own file name
  var createdDocument = null;  // a new document, kept so a retry doesn't create another
  var saving = false;
  var templateLoadId = 0;
  var phraseLoadId = 0;
  var documentSearchId = 0;
  var caseSearchId = 0;
  var documentTimer = null;
  var caseTimer = null;

  function showStatus(message, problem) {
    status.textContent = message;
    status.classList.toggle("problem", !!problem);
  }

  function handleError(error, prefix) {
    if (error instanceof window.OpenCaseApi.NotLoggedInError) {
      showLogin(error.message);
    } else {
      showStatus((prefix || "FEJL: ") + error.message, true);
    }
  }

  function documentLabel(doc) {
    return [doc.documentnumber, doc.title].filter(Boolean).join(" — ");
  }

  function caseLabel(c) {
    return [c.caseNumber, c.title].filter(Boolean).join(" — ");
  }

  function extensionOf(name) {
    var dot = (name || "").lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  }

  // Fills a list the user picks one item from.
  // options: { label, sub, disabled, selected, onPick, empty }
  function renderPickList(list, items, options) {
    list.replaceChildren();
    if (!items.length) {
      message(list, options.empty);
      return;
    }
    items.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "pick";
      li.setAttribute("role", "option");
      li.textContent = options.label(item);
      var subText = options.sub && options.sub(item);
      if (subText) {
        var sub = document.createElement("div");
        sub.className = "sub";
        sub.textContent = subText;
        li.appendChild(sub);
      }
      li.setAttribute("aria-selected", String(!!options.selected && options.selected(item)));
      if (options.disabled && options.disabled(item)) {
        li.setAttribute("aria-disabled", "true");
      } else {
        li.addEventListener("click", function () { options.onPick(item); });
      }
      list.appendChild(li);
    });
  }

  function message(list, text) {
    list.replaceChildren();
    var li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    list.appendChild(li);
  }

  // --- Which document --------------------------------------------------------

  function target() {
    var checked = document.querySelector('input[name="target"]:checked');
    return checked ? checked.value : null;
  }

  // GET /templates and /phrases take the document, or the case for a
  // document that is created when the user clicks Opret.
  function context() {
    switch (target()) {
      case "current":
        return currentDocument ? { documentId: currentDocument.id } : null;
      case "existing":
        return pickedDocument ? { documentId: pickedDocument.id } : null;
      case "new":
        return pickedCase ? { caseId: pickedCase.id } : null;
    }
    return null;
  }

  document.querySelectorAll('input[name="target"]').forEach(function (radio) {
    radio.addEventListener("change", onTargetChange);
  });

  function onTargetChange() {
    var value = target();
    $("existing-form").hidden = value !== "existing";
    $("new-form").hidden = value !== "new";
    targetHint.textContent = "";
    if (value === "existing" && !listDocuments) loadListDocuments();
    if (value === "new" && category.options.length <= 1) loadCategories();
    contextChanged();
  }

  async function loadCurrentDocument() {
    try {
      currentDocument = await window.OpenCaseApi.get("/files/" + encodeURIComponent(openFileId) + "/document");
    } catch (error) {
      if (error instanceof window.OpenCaseApi.NotLoggedInError) throw error;
      currentDocument = null;
      return;
    }
    var radio = document.querySelector('input[name="target"][value="current"]');
    $("current-choice").hidden = false;
    $("current-label").textContent = "Det åbne dokument: " + documentLabel(currentDocument);
    if (currentDocument.canWrite === false) {
      radio.disabled = true;
      $("current-label").textContent += " (kun læseadgang)";
    } else {
      radio.checked = true;
    }
  }

  // Documents to pick from without searching: the user's own lists.
  async function loadListDocuments() {
    message(documentsList, "Henter dokumenter...");
    try {
      var lists = await Promise.all(LISTS.map(function (type) {
        return window.OpenCaseApi.get("/documents/" + type).catch(function (error) {
          if (error instanceof window.OpenCaseApi.NotLoggedInError) throw error;
          return [];
        });
      }));
      var seen = {};
      listDocuments = [];
      lists.forEach(function (data) {
        var list = Array.isArray(data) ? data : (data && (data.documents || data.data)) || [];
        list.forEach(function (doc) {
          if (doc && doc.id !== undefined && !seen[doc.id]) {
            seen[doc.id] = true;
            listDocuments.push(doc);
          }
        });
      });
      if (!documentSearch.value.trim()) renderDocuments(listDocuments, "Ingen seneste dokumenter eller favoritter. Søg efter et dokument.");
    } catch (error) {
      message(documentsList, "");
      handleError(error);
    }
  }

  function renderDocuments(docs, empty) {
    renderPickList(documentsList, docs, {
      label: documentLabel,
      sub: function (doc) { return doc.case ? caseLabel(doc.case) : ""; },
      selected: function (doc) { return !!pickedDocument && pickedDocument.id === doc.id; },
      onPick: function (doc) {
        pickedDocument = doc;
        renderDocuments(docs, empty);
        contextChanged();
      },
      empty: empty
    });
  }

  documentSearch.addEventListener("input", function () {
    clearTimeout(documentTimer);
    var text = documentSearch.value.trim();
    if (!text) {
      documentSearchId++;
      if (listDocuments) renderDocuments(listDocuments, "Ingen seneste dokumenter eller favoritter.");
      return;
    }
    documentTimer = setTimeout(function () { searchDocuments(text); }, SEARCH_DELAY_MS);
  });

  // The full-text search finds files; show each file's document once.
  async function searchDocuments(text) {
    var id = ++documentSearchId;
    message(documentsList, "Søger...");
    try {
      var data = await window.OpenCaseApi.get("/documents/fulltextsearch", { q: text, limit: 50 });
      if (id !== documentSearchId) return;
      var seen = {};
      var docs = [];
      ((data && data.files) || []).forEach(function (file) {
        var doc = file.document;
        if (doc && doc.id !== undefined && !seen[doc.id]) {
          seen[doc.id] = true;
          docs.push(Object.assign({ case: file.case }, doc));
        }
      });
      renderDocuments(docs, "Ingen dokumenter fundet");
    } catch (error) {
      if (id !== documentSearchId) return;
      message(documentsList, "");
      handleError(error);
    }
  }

  // New document: the case must allow writing.
  caseSearch.addEventListener("input", function () {
    clearTimeout(caseTimer);
    var text = caseSearch.value.trim();
    casesList.hidden = !text;
    if (!text) return;
    caseTimer = setTimeout(function () { searchCases(text); }, SEARCH_DELAY_MS);
  });

  async function searchCases(text) {
    var id = ++caseSearchId;
    message(casesList, "Søger...");
    try {
      var cases = await window.OpenCaseApi.get("/cases", { search: text });
      if (id !== caseSearchId) return;
      renderCases(cases || []);
    } catch (error) {
      if (id !== caseSearchId) return;
      message(casesList, "");
      handleError(error);
    }
  }

  function renderCases(cases) {
    renderPickList(casesList, cases, {
      label: caseLabel,
      sub: function (c) {
        return [c.organisation, c.status, c.canWrite ? null : "ingen skriveadgang"].filter(Boolean).join(" · ");
      },
      disabled: function (c) { return !c.canWrite; },
      selected: function (c) { return !!pickedCase && pickedCase.id === c.id; },
      onPick: function (c) {
        pickedCase = c;
        createdDocument = null;
        renderCases(cases);
        contextChanged();
      },
      empty: "Ingen sager fundet"
    });
  }

  async function loadCategories() {
    try {
      var categories = await window.OpenCaseApi.get("/document-categories");
      while (category.options.length > 1) category.remove(1);
      (categories || []).forEach(function (item) {
        var option = new Option(item.name, String(item.id));
        if (item.description) option.title = item.description;
        category.add(option);
      });
    } catch (error) {
      handleError(error);
    }
  }

  // --- Template -----------------------------------------------------------------

  function contextChanged() {
    var ctx = context();
    var key = ctx ? JSON.stringify(ctx) : null;
    if (key === contextKey) return;
    contextKey = key;
    if (!ctx) {
      templates = [];
      pickTemplate(null);
      message(templatesList, "Vælg først et dokument.");
      return;
    }
    loadTemplates(ctx);
  }

  async function loadTemplates(ctx) {
    var id = ++templateLoadId;
    message(templatesList, "Henter skabeloner...");
    try {
      var data = await window.OpenCaseApi.get("/templates", ctx);
      if (id !== templateLoadId) return;
      templates = (Array.isArray(data) ? data : []).slice().sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name), "da");
      });
      // Keep the template if the new document's case can use it too.
      var keep = pickedTemplate && templates.find(function (t) { return t.id === pickedTemplate.id; });
      pickTemplate(keep || null);
    } catch (error) {
      if (id !== templateLoadId) return;
      templates = [];
      pickTemplate(null);
      message(templatesList, "");
      handleError(error, "Skabelonerne kunne ikke hentes: ");
    }
  }

  templateSearch.addEventListener("input", renderTemplates);

  function renderTemplates() {
    if (!contextKey) return;
    if (!templates.length) {
      message(templatesList, "Ingen skabeloner tilgængelige");
      return;
    }
    var words = templateSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
    var matches = templates.filter(function (t) {
      var text = (t.name + " " + (t.originalFilename || "")).toLowerCase();
      return words.every(function (word) { return text.indexOf(word) >= 0; });
    });
    renderPickList(templatesList, matches, {
      label: function (t) { return t.name; },
      sub: function (t) { return t.originalFilename; },
      selected: function (t) { return !!pickedTemplate && pickedTemplate.id === t.id; },
      onPick: pickTemplate,
      empty: "Ingen skabeloner matcher søgningen"
    });
  }

  // Also called after the context changed, so the phrases are always reloaded.
  function pickTemplate(template) {
    pickedTemplate = template;
    renderTemplates();
    if (template && !filenameTouched) filenameInput.value = template.name;
    var ext = template && extensionOf(template.originalFilename);
    filenameHint.textContent = ext ? "Filtypen (" + ext + ") bevares." : "";
    // A new document gets the template's name as its title, unless typed.
    if (template && !docTitle.dataset.touched) docTitle.value = template.name;
    loadPhrases();
  }

  filenameInput.addEventListener("input", function () {
    // Empty again: follow the template's name once more.
    filenameTouched = filenameInput.value.trim() !== "";
  });

  docTitle.addEventListener("input", function () {
    docTitle.dataset.touched = docTitle.value.trim() ? "1" : "";
  });

  // --- Phrases ------------------------------------------------------------------

  async function loadPhrases() {
    var id = ++phraseLoadId;
    phrases = [];
    var ctx = context();
    if (!pickedTemplate || !ctx) {
      phrasesList.replaceChildren(emptyPhrase("Vælg en skabelon for at se dens fraser."));
      return;
    }
    phrasesList.replaceChildren(emptyPhrase("Henter fraser..."));
    try {
      var data = await window.OpenCaseApi.get("/templates/" + encodeURIComponent(pickedTemplate.id) + "/phrases", ctx);
      if (id !== phraseLoadId) return;
      phrases = Array.isArray(data) ? data : [];
      renderPhrases();
    } catch (error) {
      if (id !== phraseLoadId) return;
      phrasesList.replaceChildren(emptyPhrase(""));
      handleError(error, "Fraserne kunne ikke hentes: ");
    }
  }

  function emptyPhrase(text) {
    var li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    return li;
  }

  // In the template's order, which is the order they are inserted in.
  function renderPhrases() {
    if (!phrases.length) {
      phrasesList.replaceChildren(emptyPhrase("Skabelonen har ingen fraser, der kan bruges i denne sag."));
      return;
    }
    phrasesList.replaceChildren();
    phrases.forEach(function (phrase) {
      var li = document.createElement("li");
      li.className = "phrase";

      var box = document.createElement("input");
      box.type = "checkbox";
      box.id = "phrase-" + phrase.phraseId;
      box.value = String(phrase.phraseId);
      // An obligatory phrase is always inserted.
      box.checked = !!(phrase.isRequired || phrase.isDefault);
      box.disabled = !!phrase.isRequired;
      li.appendChild(box);

      var text = document.createElement("label");
      text.htmlFor = box.id;
      var title = document.createElement("div");
      title.className = "title";
      title.textContent = phrase.title;
      if (phrase.isRequired) addBadge(title, "Obligatorisk");
      else if (phrase.isDefault) addBadge(title, "Forudvalgt");
      text.appendChild(title);
      var subText = [phrase.categoryPath, phrase.description].filter(Boolean).join(" · ");
      if (subText) {
        var sub = document.createElement("div");
        sub.className = "sub";
        sub.textContent = subText;
        text.appendChild(sub);
      }
      li.appendChild(text);
      phrasesList.appendChild(li);
    });
  }

  function addBadge(parent, text) {
    var badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = text;
    parent.appendChild(badge);
  }

  function checkedPhraseIds() {
    return Array.prototype.map.call(phrasesList.querySelectorAll("input:checked"), function (box) {
      return Number(box.value);
    });
  }

  // --- Create -------------------------------------------------------------------

  function validate() {
    var value = target();
    if (!value) return "Vælg, hvilket dokument filen skal oprettes på.";
    if (value === "existing" && !pickedDocument) return "Vælg et dokument.";
    if (value === "new") {
      if (!pickedCase) return "Vælg en sag til det nye dokument.";
      if (!docTitle.value.trim()) return "Skriv en titel til det nye dokument.";
      if (!category.value) return "Vælg en dokumentkategori til det nye dokument.";
    }
    if (!pickedTemplate) return "Vælg en skabelon.";
    return null;
  }

  async function create() {
    if (saving) return;
    var problem = validate();
    if (problem) {
      showStatus(problem, true);
      return;
    }

    saving = true;
    createButton.disabled = true;
    try {
      var documentId;
      if (target() === "new") {
        if (!createdDocument) {
          showStatus("Opretter dokumentet...");
          createdDocument = await window.OpenCaseApi.post("/documents", { json: {
            caseId: pickedCase.id,
            title: docTitle.value.trim(),
            documentCategoryId: Number(category.value)
          } });
        }
        documentId = createdDocument.id;
      } else {
        documentId = context().documentId;
      }

      // Merging can take a few seconds, especially with a logo or many phrases.
      showStatus("Opretter…");
      var body = { templateId: pickedTemplate.id, phraseIds: checkedPhraseIds() };
      var filename = filenameInput.value.trim();
      if (filename) body.filename = filename;
      var file = await window.OpenCaseApi.post(
        "/documents/" + encodeURIComponent(documentId) + "/files/from-template", { json: body });

      showStatus("Filen " + file.name + " er oprettet. Åbner den...");
      window.Asc.plugin.sendToPlugin("onFileFromTemplateCreated", file);
    } catch (error) {
      if (error.status === 500) {
        showStatus("Kunne ikke oprette fil fra skabelon", true);
      } else if (createdDocument && target() === "new") {
        handleError(error, "Dokumentet " + (createdDocument.documentnumber || "") +
          " er oprettet, men filen blev ikke oprettet: ");
      } else {
        handleError(error);
      }
    } finally {
      saving = false;
      createButton.disabled = false;
    }
  }

  createButton.addEventListener("click", create);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
  });

  function showLogin(text) {
    showStatus(text + " (" + window.OpenCaseSettings.getUrl() + ")", true);
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

  // --- Start ----------------------------------------------------------------------

  async function start() {
    showStatus("Henter...");
    message(templatesList, "Vælg først et dokument.");
    phrasesList.replaceChildren(emptyPhrase("Vælg en skabelon for at se dens fraser."));
    try {
      if (openFileId && !currentDocument) await loadCurrentDocument();
      if (!target()) {
        document.querySelector('input[name="target"][value="existing"]').checked = true;
      }
      contextKey = undefined; // load the templates even if the context is unchanged
      onTargetChange();
      showStatus("");
    } catch (error) {
      handleError(error);
    }
  }

  window.Asc.plugin.init = function () {
    window.Asc.plugin.sendToPlugin("onFromTemplateReady", null);
  };

  // From the main plugin: the open file, if it is a document from OpenCase.
  window.Asc.plugin.attachEvent("onShowFromTemplate", function (data) {
    openFileId = data && data.fileId;
    start();
  });

  window.Asc.plugin.attachEvent("onLoggedIn", function () {
    start();
  });

  window.Asc.plugin.attachEvent("onLoginFailed", function (data) {
    showLogin("Login fejlede: " + (data && data.error));
  });

  // Result of opening the new file, from the main plugin.
  window.Asc.plugin.attachEvent("onDesktopApiTest", function (data) {
    if (data && data.commandExecuted === false) {
      showStatus("Filen er oprettet, men kunne ikke åbnes: " + data.error, true);
    }
  });
})(window);
