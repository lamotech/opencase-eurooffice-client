// The form for a new document on a case, with two tabs as in OpenCase:
// "Info" (case, title, category, type, insight level, dates, summary) and
// "Afsendere/modtagere" (contacts, added once the document exists).
// Shared by Gem i OpenCase and Ny fil fra skabelon.
// Requires scripts/api.js, scripts/panel.js and scripts/contacts.js, and
// resources/styles/panel.css and resources/styles/document-form.css.
(function (window) {
  var Api = window.OpenCaseApi;
  var CASE_SEARCH_DELAY_MS = 300; // as the case picker in the Files app

  var TEMPLATE = [
    '<div class="tabs" role="tablist">',
    '  <button class="tab" type="button" role="tab" data-tab="info" aria-selected="true">Info</button>',
    '  <button class="tab" type="button" role="tab" data-tab="contacts" aria-selected="false">Afsendere/modtagere</button>',
    '</div>',
    '<div class="tab-panel" role="tabpanel" data-panel="info">',
    '  <div class="field">',
    '    <label class="required" for="{p}case-search">Sag</label>',
    '    <div class="case-picker">',
    '      <div class="selected-case" data-el="selected-case" hidden>',
    '        <span data-el="selected-case-text"></span>',
    '        <button class="link-button" data-el="change-case" type="button">Skift</button>',
    '      </div>',
    '      <input id="{p}case-search" data-el="case-search" type="text" autocomplete="off"',
    '             placeholder="Søg på sagsnummer eller titel" role="combobox" aria-autocomplete="list"',
    '             aria-expanded="false" aria-controls="{p}case-results">',
    '      <ul class="case-results" id="{p}case-results" data-el="case-results" role="listbox" hidden></ul>',
    '    </div>',
    '    <div class="error" data-error="case"></div>',
    '  </div>',
    '  <div class="field">',
    '    <label class="required" for="{p}title">Titel</label>',
    '    <input id="{p}title" data-el="title" type="text" autocomplete="off">',
    '    <div class="error" data-error="title"></div>',
    '  </div>',
    '  <div class="row">',
    '    <div class="field">',
    '      <label class="required" for="{p}category">Dokumentkategori</label>',
    '      <select id="{p}category" data-el="category"><option value="">Vælg...</option></select>',
    '      <div class="error" data-error="category"></div>',
    '    </div>',
    '    <div class="field">',
    '      <label for="{p}document-type">Dokumenttype</label>',
    '      <select id="{p}document-type" data-el="document-type"><option value="">(Ingen)</option></select>',
    '    </div>',
    '  </div>',
    '  <div class="field">',
    '    <label for="{p}insight-level">Indsigtsgrad</label>',
    '    <select id="{p}insight-level" data-el="insight-level"><option value="">Sagens indsigtsgrad</option></select>',
    '    <div class="hint" data-el="insight-level-hint"></div>',
    '  </div>',
    '  <div class="row">',
    '    <div class="field">',
    '      <label for="{p}document-date">Dokumentdato</label>',
    '      <input id="{p}document-date" data-el="document-date" type="date">',
    '    </div>',
    '    <div class="field">',
    '      <label for="{p}received-date">Modtaget dato</label>',
    '      <input id="{p}received-date" data-el="received-date" type="date">',
    '    </div>',
    '    <div class="field">',
    '      <label for="{p}registered-date">Registreret dato</label>',
    '      <input id="{p}registered-date" data-el="registered-date" type="date">',
    '    </div>',
    '  </div>',
    '  <div class="field">',
    '    <span class="label" id="{p}summary-label">Dokumentresume</span>',
    '    <div class="toolbar" role="toolbar" aria-label="Formatering">',
    '      <button type="button" data-command="bold" title="Fed (Ctrl+B)"><b>F</b></button>',
    '      <button type="button" data-command="italic" title="Kursiv (Ctrl+I)"><i>K</i></button>',
    '      <button type="button" data-command="underline" title="Understreget (Ctrl+U)"><u>U</u></button>',
    '      <button type="button" data-command="insertUnorderedList" title="Punktopstilling">•</button>',
    '      <button type="button" data-command="insertOrderedList" title="Nummereret liste">1.</button>',
    '    </div>',
    '    <div class="editor" data-el="summary" contenteditable="true" role="textbox" aria-multiline="true"',
    '         aria-labelledby="{p}summary-label"></div>',
    '  </div>',
    '</div>',
    '<div class="tab-panel" role="tabpanel" data-panel="contacts" hidden>',
    '  <div class="section-head" data-el="contacts-head"><h3>Afsendere og modtagere</h3></div>',
    '  <div class="hint" data-el="contacts-hint"></div>',
    '  <div data-el="contacts"></div>',
    '</div>'
  ].join("\n");

  function caseLabel(c) {
    return [c.caseNumber, c.title].filter(Boolean).join(" — ");
  }

  function today() {
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  }

  // root: the element to build the form in.
  // options:
  //   idPrefix:      prefix for element ids, so the form fits in another page
  //   submitLabel:   the button that creates the document, for the hints ("Gem")
  //   showStatus(message, problem), onNotLoggedIn(message)
  //   onCaseChange(case): the picked case changed (null when cleared)
  function create(root, options) {
    var prefix = options.idPrefix || "df-";
    root.classList.add("document-form");
    root.innerHTML = TEMPLATE.replace(/\{p\}/g, prefix);

    var el = function (name) { return root.querySelector('[data-el="' + name + '"]'); };
    var caseSearch = el("case-search");
    var caseResults = el("case-results");
    var selectedCaseBox = el("selected-case");
    var titleInput = el("title");
    var category = el("category");
    var documentType = el("document-type");
    var insightLevel = el("insight-level");
    var summary = el("summary");

    var selectedCase = null;
    var caseOptions = [];
    var activeOption = -1;
    var caseTimer = null;
    var caseSearchId = 0;
    var insightLevels = [];
    var titleTouched = false;
    var createdDocument = null; // kept so a retry doesn't create a second document
    var busy = false;
    var listsLoaded = false;

    el("document-date").value = today();
    el("contacts-hint").textContent = "Kontakterne tilføjes dokumentet, når du trykker " +
      (options.submitLabel || "Gem") + ".";

    // --- Tabs ---------------------------------------------------------------------

    function showTab(id) {
      root.querySelectorAll("[data-tab]").forEach(function (tab) {
        tab.setAttribute("aria-selected", String(tab.dataset.tab === id));
      });
      root.querySelectorAll("[data-panel]").forEach(function (panel) {
        panel.hidden = panel.dataset.panel !== id;
      });
    }

    root.querySelectorAll("[data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () { showTab(tab.dataset.tab); });
    });

    // --- Lists ------------------------------------------------------------------------

    async function loadLists() {
      var results = await Promise.all([
        Api.get("/document-categories"),
        Api.get("/document-types"),
        Api.get("/insight-levels")
      ]);
      fillSelect(category, results[0], function (item) { return item.id; });
      // The document type is sent by name.
      fillSelect(documentType, results[1], function (item) { return item.name; });
      insightLevels = results[2] || [];
      fillSelect(insightLevel, insightLevels, function (item) { return item.id; });
      listsLoaded = true;
    }

    function fillSelect(select, items, valueOf) {
      var current = select.value;
      // Keep the first, empty option.
      while (select.options.length > 1) select.remove(1);
      (items || []).forEach(function (item) {
        var option = new Option(item.name, String(valueOf(item)));
        if (item.description) option.title = item.description;
        select.add(option);
      });
      select.value = current;
    }

    insightLevel.addEventListener("change", function () {
      var level = insightLevels.find(function (item) { return String(item.id) === insightLevel.value; });
      el("insight-level-hint").textContent = level && level.description ? level.description : "";
    });

    // --- Case picker ------------------------------------------------------------------

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
        var cases = await Api.get("/cases", { search: text });
        if (id !== caseSearchId) return;
        renderCaseResults(cases || []);
      } catch (error) {
        if (id !== caseSearchId) return;
        if (error instanceof Api.NotLoggedInError) {
          closeCaseResults();
          options.onNotLoggedIn(error.message);
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
        li.id = prefix + "case-option-" + index;
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
      var active = caseResults.children[index];
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
      el("selected-case-text").textContent = caseLabel(c);
      selectedCaseBox.hidden = false;
      caseSearch.hidden = true;
      closeCaseResults();
      clearError("case");
      if (options.onCaseChange) options.onCaseChange(c);
    }

    el("change-case").addEventListener("click", function () {
      selectedCase = null;
      selectedCaseBox.hidden = true;
      caseSearch.hidden = false;
      caseSearch.value = "";
      caseSearch.focus();
      if (options.onCaseChange) options.onCaseChange(null);
    });

    // --- Rich text summary ------------------------------------------------------------

    root.querySelectorAll(".toolbar button").forEach(function (b) {
      // mousedown keeps the selection in the editor.
      b.addEventListener("mousedown", function (event) { event.preventDefault(); });
      b.addEventListener("click", function () {
        summary.focus();
        document.execCommand(b.dataset.command, false, null);
      });
    });

    function summaryHtml() {
      var empty = !summary.textContent.trim() && !summary.querySelector("img, li");
      return empty ? null : summary.innerHTML;
    }

    // --- Afsendere/modtagere ------------------------------------------------------------

    // Collected here and added (POST /documents/{id}/contacts) right after the
    // document is created. Each keeps its request body; serverId is set once
    // it has been added.
    function sameContact(a, b) {
      return a._body.roleId === b.roleId && !!b.cprCvr &&
        String(a._body.cprCvr || "") === String(b.cprCvr) && String(a._body.pnumber || "") === String(b.pnumber || "");
    }

    var contactsTab = root.querySelector('[data-tab="contacts"]');
    var contacts = window.OpenCaseContacts.create({
      box: el("contacts"),
      store: {
        add: async function (body, preview) {
          // The server would answer 409; say so before the document exists.
          if (contacts.list().some(function (c) { return sameContact(c, body); })) {
            var duplicate = new Error("Kontakten er allerede tilføjet med den valgte rolle");
            duplicate.status = 409;
            throw duplicate;
          }
          return Object.assign({}, preview, { _body: body, serverId: null });
        },
        remove: async function (contact) {
          if (contact.serverId && createdDocument) {
            await Api.del("/documents/" + encodeURIComponent(createdDocument.id) +
              "/contacts/" + encodeURIComponent(contact.serverId));
          }
        }
        // No revealAddress: a protected address can only be looked up once the
        // contact is on a document.
      },
      canChange: function () { return !busy; },
      onChange: function () {
        var count = contacts ? contacts.count() : 0;
        contactsTab.textContent = "Afsendere/modtagere" + (count ? " (" + count + ")" : "");
      },
      showStatus: options.showStatus,
      onNotLoggedIn: options.onNotLoggedIn,
      emptyText: "Ingen afsendere eller modtagere endnu"
    });
    contacts.addButtons().forEach(function (b) { el("contacts-head").appendChild(b); });
    contacts.render();

    // Adds the contacts not added yet. Throws on the first one that fails, so
    // the user can fix or remove it and try again.
    async function addPendingContacts() {
      var pending = contacts.list().filter(function (c) { return !c.serverId; });
      for (var i = 0; i < pending.length; i++) {
        var contact = pending[i];
        options.showStatus("Tilføjer " + contact.name + "...");
        try {
          var added = await Api.post("/documents/" + encodeURIComponent(createdDocument.id) + "/contacts",
            { json: contact._body });
          contact.serverId = added && added.id;
        } catch (error) {
          if (error instanceof Api.NotLoggedInError) throw error;
          var text = error.status === 409 ? "er allerede tilføjet med den valgte rolle"
            : error.status === 404 ? "blev ikke fundet i registret" : error.message;
          var wrapped = new Error("Dokumentet " + (createdDocument.documentnumber || "") + " er oprettet, men kontakten " +
            contact.name + " " + text + ". Ret eller fjern den under Afsendere/modtagere, og tryk " +
            (options.submitLabel || "Gem") + " igen.");
          wrapped.contactProblem = true;
          throw wrapped;
        }
      }
    }

    // --- Validation and creating ------------------------------------------------------

    var fieldInputs = { case: caseSearch, title: titleInput, category: category };

    function setError(field, message) {
      root.querySelector('[data-error="' + field + '"]').textContent = message;
      fieldInputs[field].classList.add("invalid");
    }

    function clearError(field) {
      root.querySelector('[data-error="' + field + '"]').textContent = "";
      fieldInputs[field].classList.remove("invalid");
    }

    titleInput.addEventListener("input", function () {
      clearError("title");
      titleTouched = titleInput.value.trim() !== "";
    });
    category.addEventListener("change", function () { clearError("category"); });

    // Marks the missing fields and shows the Info tab. Returns true when valid.
    function validate() {
      if (createdDocument) return true; // only the rest can be retried now
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
      if (firstInvalid) {
        showTab("info");
        firstInvalid.focus();
      }
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
      if (el("document-date").value) body.documentDate = el("document-date").value;
      if (el("received-date").value) body.receivedDate = el("received-date").value;
      if (el("registered-date").value) body.registeredDate = el("registered-date").value;
      var html = summaryHtml();
      if (html) body.summary = html;
      return body;
    }

    // Creates the document (once) and adds the contacts not added yet.
    // Resolves with the document. On a contact that fails, the error has
    // contactProblem set and the contacts tab is shown.
    async function createDocument() {
      if (!createdDocument) {
        options.showStatus("Opretter dokumentet i OpenCase...");
        createdDocument = await Api.post("/documents", { json: documentBody() });
        lockInfo(true);
      }
      try {
        await addPendingContacts();
      } catch (error) {
        if (error.contactProblem) showTab("contacts");
        throw error;
      }
      return createdDocument;
    }

    // After the document exists, its fields can't be changed here. The
    // contacts stay open, so one that couldn't be added can be fixed.
    function lockInfo(locked) {
      root.querySelector('[data-panel="info"]').querySelectorAll("input, select, button").forEach(function (control) {
        control.disabled = locked;
      });
      summary.contentEditable = locked ? "false" : "true";
    }

    return {
      loadLists: loadLists,
      listsLoaded: function () { return listsLoaded; },
      validate: validate,
      createDocument: createDocument,
      createdDocument: function () { return createdDocument; },
      selectedCase: function () { return selectedCase; },
      showTab: showTab,
      // Fills in the title, unless the user typed their own (force: always).
      setTitle: function (text, force) {
        if (force || !titleTouched) titleInput.value = text || "";
      },
      // No deleting contacts while saving.
      setBusy: function (value) {
        busy = !!value;
        contacts.render();
      },
      focus: function () {
        (selectedCase ? titleInput : caseSearch).focus();
      }
    };
  }

  window.OpenCaseDocumentForm = { create: create };
})(window);
