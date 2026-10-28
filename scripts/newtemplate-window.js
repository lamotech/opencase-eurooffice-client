// "Ny skabelon": creates a template (POST /templates) with a name,
// organisations, a blank or uploaded file and the phrases to offer with it,
// as the Ny skabelon dialog in OpenCase does. A new blank template is opened
// in the editor by the main plugin afterwards.
(function (window) {
  var PHRASE_RELOAD_DELAY_MS = 300;
  var UPLOAD_EXTENSIONS = ["docx", "odt", "xlsx", "ods"];
  var DRAFT_NOTE = "Kladde — indsættes ikke i breve, før frasen er aktiv.";

  var $ = function (id) { return document.getElementById(id); };
  var nameInput = $("name");
  var orgsBox = $("orgs");
  var uploadBox = $("upload-box");
  var blankHint = $("blank-hint");
  var fileInput = $("file");
  var phraseSearch = $("phrase-search");
  var availableList = $("available");
  var selectedList = $("selected");
  var status = $("status");

  var phrases = [];          // latest GET /phrases response
  var phrasesLoaded = false; // false until a response matches the current choices
  var phraseLoadId = 0;
  var phraseTimer = null;
  // { phrase, isRequired, isDefault, missing }, in the order they are offered.
  var selected = [];
  var saving = false;
  var created = null;        // the template, once created

  function showStatus(message, problem) {
    status.textContent = message;
    status.classList.toggle("problem", !!problem);
  }

  // --- Tabs -----------------------------------------------------------------

  function showTab(name) {
    ["general", "phrases"].forEach(function (tab) {
      $("tab-" + tab).setAttribute("aria-selected", String(tab === name));
      $("panel-" + tab).hidden = tab !== name;
    });
  }

  $("tab-general").addEventListener("click", function () { showTab("general"); });
  $("tab-phrases").addEventListener("click", function () { showTab("phrases"); });

  function updatePhrasesTab() {
    var tab = $("tab-phrases");
    tab.textContent = "Fraser" + (selected.length ? " (" + selected.length + ")" : "");
    if (selected.some(function (item) { return item.missing; })) {
      var dot = document.createElement("span");
      dot.className = "problem-dot";
      dot.title = "Nogle fraser passer ikke til de valgte organisationer";
      tab.appendChild(dot);
    }
  }

  // --- Generelt ---------------------------------------------------------------

  async function loadOrganisations() {
    var organisations = await window.OpenCaseApi.get("/organisations");
    orgsBox.replaceChildren();
    if (!organisations || !organisations.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Ingen organisationer";
      orgsBox.appendChild(empty);
      return;
    }
    organisations.forEach(function (org) {
      var label = document.createElement("label");
      label.style.paddingLeft = (Number(org.depth) || 0) * 18 + "px";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.value = org.uuid;
      box.addEventListener("change", schedulePhraseReload);
      label.appendChild(box);
      label.appendChild(document.createTextNode(org.name));
      orgsBox.appendChild(label);
    });
  }

  function selectedOrgUuids() {
    return Array.prototype.map.call(orgsBox.querySelectorAll("input:checked"), function (box) {
      return box.value;
    });
  }

  function fileMode() {
    return document.querySelector('input[name="file-mode"]:checked').value;
  }

  function uploadExtension() {
    var file = fileInput.files[0];
    if (!file) return "";
    var dot = file.name.lastIndexOf(".");
    return dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  }

  // GET /phrases templateFormat: "blank", or the uploaded file's extension.
  function templateFormat() {
    if (fileMode() === "blank") return "blank";
    var ext = uploadExtension();
    return UPLOAD_EXTENSIONS.indexOf(ext) >= 0 ? ext : "";
  }

  document.querySelectorAll('input[name="file-mode"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
      var upload = fileMode() === "upload";
      uploadBox.hidden = !upload;
      blankHint.hidden = upload;
      $("file-error").textContent = "";
      schedulePhraseReload();
    });
  });

  fileInput.addEventListener("change", function () {
    var ext = uploadExtension();
    $("file-error").textContent = fileInput.files[0] && UPLOAD_EXTENSIONS.indexOf(ext) < 0
      ? "Filtypen ." + ext + " kan ikke bruges. Vælg en .docx-, .odt-, .xlsx- eller .ods-fil."
      : "";
    schedulePhraseReload();
  });

  // --- Fraser -------------------------------------------------------------------

  // The phrases depend on the organisations and the file type, so they are
  // fetched again when either changes.
  function schedulePhraseReload() {
    phrasesLoaded = false;
    clearTimeout(phraseTimer);
    phraseTimer = setTimeout(loadPhrases, PHRASE_RELOAD_DELAY_MS);
  }

  async function loadPhrases() {
    var id = ++phraseLoadId;
    renderMessage(availableList, "Henter fraser...");
    try {
      var data = await window.OpenCaseApi.get("/phrases", {
        orgUuids: selectedOrgUuids().join(","),
        templateFormat: templateFormat()
      });
      if (id !== phraseLoadId) return;
      phrases = Array.isArray(data) ? data : [];
      phrasesLoaded = true;
      // Phrases already in the list: take the new data (formatNote depends on
      // the file type), and mark those the organisations no longer allow.
      selected.forEach(function (item) {
        var match = findPhrase(item.phrase.id);
        item.missing = !match;
        if (match) item.phrase = match;
      });
      renderAvailable();
      renderSelected();
    } catch (error) {
      if (id !== phraseLoadId) return;
      if (error instanceof window.OpenCaseApi.NotLoggedInError) {
        renderMessage(availableList, "");
        showLogin(error.message);
      } else {
        renderMessage(availableList, "Fraserne kunne ikke hentes: " + error.message);
      }
    }
  }

  function findPhrase(id) {
    return phrases.find(function (phrase) { return phrase.id === id; }) || null;
  }

  function isSelected(id) {
    return selected.some(function (item) { return item.phrase.id === id; });
  }

  function renderMessage(list, message) {
    list.replaceChildren();
    if (!message) return;
    var li = document.createElement("li");
    li.className = "empty";
    li.textContent = message;
    list.appendChild(li);
  }

  function matchesSearch(phrase, words) {
    var text = [phrase.title, phrase.categoryPath, phrase.description].join(" ").toLowerCase();
    return words.every(function (word) { return text.indexOf(word) >= 0; });
  }

  phraseSearch.addEventListener("input", renderAvailable);

  // Title, category and description, the format note and the draft note.
  function phraseText(phrase) {
    var text = document.createElement("div");
    text.className = "text";

    var title = document.createElement("div");
    title.className = "title";
    title.textContent = phrase.title;
    if (phrase.status === "draft") {
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Kladde";
      title.appendChild(badge);
    }
    text.appendChild(title);

    var sub = [phrase.categoryPath, phrase.description].filter(Boolean).join(" · ");
    if (sub) addLine(text, "sub", sub);
    if (phrase.status === "draft") addLine(text, "note", DRAFT_NOTE);
    if (phrase.formatNote) addLine(text, "note", phrase.formatNote);
    return text;
  }

  function addLine(parent, className, value) {
    var line = document.createElement("div");
    line.className = className;
    line.textContent = value;
    parent.appendChild(line);
  }

  function smallButton(text, label, onClick) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "small-button";
    button.textContent = text;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
  }

  function renderAvailable() {
    if (!phrasesLoaded) return;
    var words = phraseSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
    var matches = phrases.filter(function (phrase) { return matchesSearch(phrase, words); });
    if (!matches.length) {
      renderMessage(availableList, phrases.length ? "Ingen fraser matcher søgningen" : "Ingen fraser");
      return;
    }
    availableList.replaceChildren();
    matches.forEach(function (phrase) {
      var li = document.createElement("li");
      li.className = "phrase";
      li.appendChild(phraseText(phrase));

      var added = isSelected(phrase.id);
      var button = smallButton(added ? "Tilføjet" : "Tilføj", "Tilføj " + phrase.title, function () {
        addPhrase(phrase);
      });
      button.disabled = added;
      li.appendChild(button);
      availableList.appendChild(li);
    });
  }

  function addPhrase(phrase) {
    if (isSelected(phrase.id)) return; // a phrase can be in the list only once
    selected.push({ phrase: phrase, isRequired: false, isDefault: false, missing: false });
    renderAvailable();
    renderSelected();
  }

  function moveSelected(index, step) {
    var target = index + step;
    if (target < 0 || target >= selected.length) return;
    var item = selected.splice(index, 1)[0];
    selected.splice(target, 0, item);
    renderSelected();
  }

  function removeSelected(index) {
    selected.splice(index, 1);
    renderAvailable();
    renderSelected();
  }

  function flag(text, checked, disabled, onChange) {
    var label = document.createElement("label");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = checked;
    box.disabled = disabled;
    box.addEventListener("change", function () { onChange(box.checked); });
    label.appendChild(box);
    label.appendChild(document.createTextNode(text));
    return label;
  }

  function renderSelected() {
    updatePhrasesTab();
    if (!selected.length) {
      renderMessage(selectedList, "Ingen fraser valgt. Find fraser ovenfor, og tilføj dem.");
      return;
    }
    selectedList.replaceChildren();
    selected.forEach(function (item, index) {
      var li = document.createElement("li");
      li.className = "phrase" + (item.missing ? " missing" : "");

      var text = phraseText(item.phrase);
      if (item.missing) {
        addLine(text, "missing-note",
          "Frasen passer ikke til de valgte organisationer. Fjern den, før skabelonen kan oprettes.");
      }

      var flags = document.createElement("div");
      flags.className = "flags";
      flags.appendChild(flag("Obligatorisk", item.isRequired, false, function (checked) {
        item.isRequired = checked;
        // An obligatory phrase is always pre-selected too.
        if (checked) item.isDefault = true;
        renderSelected();
      }));
      flags.appendChild(flag("Forudvalgt", item.isDefault || item.isRequired, item.isRequired, function (checked) {
        item.isDefault = checked;
      }));
      text.appendChild(flags);
      li.appendChild(text);

      var actions = document.createElement("div");
      actions.className = "actions";
      var up = smallButton("↑", "Flyt " + item.phrase.title + " op", function () { moveSelected(index, -1); });
      up.disabled = index === 0;
      var down = smallButton("↓", "Flyt " + item.phrase.title + " ned", function () { moveSelected(index, 1); });
      down.disabled = index === selected.length - 1;
      actions.appendChild(up);
      actions.appendChild(down);
      actions.appendChild(smallButton("✕", "Fjern " + item.phrase.title, function () { removeSelected(index); }));
      li.appendChild(actions);

      selectedList.appendChild(li);
    });
  }

  // --- Saving -------------------------------------------------------------------

  function phrasesBody() {
    return selected.map(function (item) {
      return {
        phraseId: item.phrase.id,
        isRequired: item.isRequired,
        isDefault: item.isDefault || item.isRequired
      };
    });
  }

  // Returns an error message, or null when the template can be sent.
  function validate() {
    if (fileMode() === "upload") {
      if (!fileInput.files[0]) {
        $("file-error").textContent = "Vælg den fil, der skal uploades.";
        showTab("general");
        return "Vælg en fil, eller vælg Ny fil.";
      }
      if (UPLOAD_EXTENSIONS.indexOf(uploadExtension()) < 0) {
        showTab("general");
        return $("file-error").textContent;
      }
    }
    if (selected.some(function (item) { return item.missing; })) {
      showTab("phrases");
      return "Fjern de fraser, der ikke passer til de valgte organisationer.";
    }
    if (selected.length && !phrasesLoaded) {
      return "Fraserne bliver kontrolleret. Prøv igen om et øjeblik.";
    }
    return null;
  }

  async function save() {
    if (saving) return;
    if (created) {
      showStatus("Skabelonen er allerede oprettet. Luk vinduet.");
      return;
    }
    var problem = validate();
    if (problem) {
      showStatus(problem, true);
      return;
    }

    saving = true;
    showStatus("Opretter skabelonen...");
    try {
      var name = nameInput.value.trim();
      var orgUuids = selectedOrgUuids();
      var phraseList = phrasesBody();
      var template;
      if (fileMode() === "blank") {
        var body = { orgUuids: orgUuids, phrases: phraseList };
        if (name) body.name = name;
        template = await window.OpenCaseApi.post("/templates", { json: body });
      } else {
        var form = new FormData();
        var file = fileInput.files[0];
        form.append("file", file, file.name);
        if (name) form.append("name", name);
        form.append("orgUuids", JSON.stringify(orgUuids));
        form.append("phrases", JSON.stringify(phraseList));
        template = await window.OpenCaseApi.post("/templates", { form: form });
      }
      created = template;
      setLocked(true);

      if (fileMode() === "blank" && template.editorUrl) {
        showStatus("Skabelonen “" + template.name + "” er oprettet. Åbner den...");
        window.Asc.plugin.sendToPlugin("onTemplateCreated", template);
      } else {
        showStatus("Skabelonen “" + template.name + "” er oprettet" +
          (template.phraseCount ? " med " + template.phraseCount + " fraser" : "") + ". Du kan lukke vinduet.");
      }
    } catch (error) {
      if (error instanceof window.OpenCaseApi.NotLoggedInError) {
        showLogin(error.message);
      } else if (error.status === 403) {
        showStatus("Du har ikke rettighed til at oprette skabeloner.", true);
      } else {
        // 400: the server's error text is meant to be shown as it is.
        showStatus(error.message, true);
      }
    } finally {
      saving = false;
    }
  }

  function setLocked(locked) {
    document.querySelectorAll(".panel input, .panel button").forEach(function (el) {
      el.disabled = locked;
    });
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

  // --- Start ----------------------------------------------------------------------

  async function start() {
    renderSelected();
    showStatus("Henter organisationer og fraser...");
    try {
      await loadOrganisations();
      await loadPhrases();
      showStatus("");
      nameInput.focus();
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

  // Sent by the main plugin when the user clicks Opret.
  window.Asc.plugin.attachEvent("onSave", function () {
    save();
  });

  window.Asc.plugin.attachEvent("onLoggedIn", function () {
    start();
  });

  window.Asc.plugin.attachEvent("onLoginFailed", function (data) {
    showLogin("Login fejlede: " + (data && data.error));
  });

  // Result of opening the new template, from the main plugin.
  window.Asc.plugin.attachEvent("onDesktopApiTest", function (data) {
    if (data && data.commandExecuted === false) {
      showStatus("Skabelonen er oprettet, men kunne ikke åbnes: " + data.error, true);
    }
  });
})(window);
