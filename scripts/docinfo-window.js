// "Dokument info": the OpenCase document of the open file
// (GET /files/{fileId}/document), with what the document page in OpenCase
// offers: status, favourite, senders and recipients, and notes. The main
// plugin sends the file ID.
(function (window) {
  var Api = window.OpenCaseApi;
  var P = window.OpenCasePanel;
  var content = document.getElementById("content");
  var status = document.getElementById("status");
  var fileId = null;

  var doc = null;        // the document info
  var statuses = [];     // GET /document-statuses
  var contacts = null;   // the Afsendere/modtagere list, see scripts/contacts.js
  var notes = [];
  var contactsBox = null;
  var notesBox = null;
  // Kept across re-renders (e.g. after a status change).
  var activeTab = "info";
  var TABS = [
    { id: "info", label: "Info" },
    { id: "files", label: "Filer" },
    { id: "contacts", label: "Afsendere/modtagere" },
    { id: "notes", label: "Noter" }
  ];

  // Summary HTML from the server: keep basic formatting only.
  var SUMMARY_TAGS = ["P", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "DIV", "SPAN"];
  // What the server keeps in notes.
  var NOTE_TAGS = ["P", "BR", "H1", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE",
    "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL"];

  function showStatus(message, problem) {
    status.textContent = message;
    status.classList.toggle("problem", !!problem);
  }

  var element = P.element;
  var button = P.button;

  function formatDate(value) {
    if (!value) return null;
    // Plain dates (YYYY-MM-DD) have no time zone; don't let one shift the day.
    var date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T00:00:00") : new Date(value);
    if (isNaN(date)) return value;
    return date.toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" });
  }

  function formatDateTime(value) {
    if (!value) return null;
    var date = new Date(value);
    if (isNaN(date)) return value;
    return date.toLocaleString("da-DK", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function formatSize(bytes) {
    if (typeof bytes !== "number") return null;
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB";
  }

  function sanitize(html, allowed) {
    var template = document.createElement("template");
    template.innerHTML = html;
    function copy(node, target) {
      node.childNodes.forEach(function (child) {
        if (child.nodeType === Node.TEXT_NODE) {
          target.appendChild(document.createTextNode(child.textContent));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (allowed.indexOf(child.nodeName) >= 0) {
            var clean = document.createElement(child.nodeName.toLowerCase());
            copy(child, clean);
            target.appendChild(clean);
          } else if (child.nodeName !== "SCRIPT" && child.nodeName !== "STYLE") {
            copy(child, target); // drop the tag, keep its text
          }
        }
      });
    }
    var fragment = document.createDocumentFragment();
    copy(template.content, fragment);
    return fragment;
  }

  function addRow(list, label, value) {
    list.appendChild(element("dt", null, label));
    var dd = element("dd");
    if (value instanceof Node) {
      dd.appendChild(value);
    } else if (value === null || value === undefined || value === "") {
      dd.appendChild(element("span", "empty-value", "—"));
    } else {
      dd.textContent = value;
    }
    list.appendChild(dd);
  }

  function byLine(when, who) {
    var parts = [formatDateTime(when), who && who.displayName ? "af " + who.displayName : null];
    return parts.filter(Boolean).join(" ") || null;
  }

  function linkButton(text, onClick) {
    return button(text, "link", onClick);
  }

  function openUrl(url) {
    window.Asc.plugin.sendToPlugin("onOpenUrl", { url: url });
  }

  function openFile(file) {
    showStatus("Åbner " + file.name + "...");
    window.Asc.plugin.sendToPlugin("onOpenDocument", {
      fileId: file.fileId,
      name: file.name,
      editorUrl: file.editorUrl
    });
  }

  function errorText(error) {
    if (error.status === 404) return "Dokumentet findes ikke længere, eller du har ikke adgang til at ændre det.";
    if (error.status === 409 && isFinal()) return "Dokumentet er endeligt, så det kan ikke ændres.";
    return error.message;
  }

  function reportError(error) {
    if (error instanceof Api.NotLoggedInError) {
      showLogin(error.message);
    } else {
      showStatus("FEJL: " + errorText(error), true);
    }
  }

  function docPath(suffix) {
    return "/documents/" + encodeURIComponent(doc.id) + (suffix || "");
  }

  function canWrite() {
    return !!doc && doc.canWrite === true;
  }

  function isFinal() {
    return !!(doc && doc.status && doc.status.isFinal);
  }

  // Senders, recipients and notes can't be changed while the status is final.
  function canChangeContent() {
    return canWrite() && !isFinal();
  }

  var openDialog = P.openDialog;
  var confirmDialog = P.confirmDialog;
  var field = P.field;
  var input = P.input;

  // --- Header: favourite and status ------------------------------------------

  function renderHeader() {
    var header = element("div", "header");

    var star = element("button", "star" + (doc.isFavorite ? " on" : ""), doc.isFavorite ? "★" : "☆");
    star.type = "button";
    star.title = doc.isFavorite ? "Fjern fra favoritter" : "Tilføj til favoritter";
    star.setAttribute("aria-label", star.title);
    star.setAttribute("aria-pressed", String(!!doc.isFavorite));
    star.addEventListener("click", function () { toggleFavorite(star); });
    header.appendChild(star);

    header.appendChild(element("h2", null, doc.title));
    if (doc.status) {
      header.appendChild(element("span", "badge" + (doc.status.isFinal ? " final" : ""), doc.status.name));
    }
    if (!canWrite()) {
      header.appendChild(element("span", "badge readonly", "Kun læseadgang"));
    }
    return header;
  }

  async function toggleFavorite(star) {
    star.disabled = true;
    try {
      var result = doc.isFavorite ? await Api.del(docPath("/favorite")) : await Api.put(docPath("/favorite"));
      doc.isFavorite = result && typeof result.isFavorite === "boolean" ? result.isFavorite : !doc.isFavorite;
      showStatus(doc.isFavorite ? "Dokumentet er tilføjet til dine favoritter." : "Dokumentet er fjernet fra dine favoritter.");
      render();
    } catch (error) {
      star.disabled = false;
      reportError(error);
    }
  }

  // The status select, or just the name without write access.
  function statusControl() {
    if (!canWrite() || !statuses.length) return doc.status && doc.status.name;
    var row = element("div", "status-row");
    var select = document.createElement("select");
    select.setAttribute("aria-label", "Status");
    statuses.forEach(function (s) {
      var option = new Option(s.name, String(s.id));
      option.selected = doc.status && s.id === doc.status.id;
      select.add(option);
    });
    select.addEventListener("change", function () {
      var picked = statuses.find(function (s) { return String(s.id) === select.value; });
      changeStatus(picked).then(function (changed) {
        if (!changed) select.value = doc.status ? String(doc.status.id) : "";
      });
    });
    row.appendChild(select);
    return row;
  }

  // Resolves true when the status was changed.
  async function changeStatus(next) {
    if (!next || (doc.status && next.id === doc.status.id)) return false;
    if (next.isFinal) {
      var ok = await confirmDialog("Gør dokumentet endeligt?",
        "Når dokumentet er endeligt, kan filerne ikke længere redigeres. Den åbne fil gemmes først.",
        "Skift til " + next.name);
      if (!ok) return false;
    }
    try {
      showStatus("Gemmer filen...");
      await saveOpenFile();
      showStatus("Skifter status til " + next.name + "...");
      var result = await Api.put(docPath("/status"), { json: { status: next.id } });
      doc.status = (result && result.status) || next;
      render();
      showStatus(doc.status.isFinal
        ? "Dokumentet er nu " + doc.status.name + ". Den åbne fil kan ikke længere gemmes, så luk den."
        : "Status er ændret til " + doc.status.name + ".");
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  // Saves the open file as the Save button does, so the last changes reach
  // OpenCase before the files become read-only. Waits up to 10 seconds.
  async function saveOpenFile() {
    var api;
    try {
      api = (window.parent.Asc && window.parent.Asc.editor) || window.parent.editor;
    } catch (e) {
      return;
    }
    if (!api || typeof api.asc_Save !== "function") return;
    var modified = function () {
      try {
        if (typeof api.isDocumentModified === "function") return api.isDocumentModified();
        if (typeof api.asc_isDocumentModified === "function") return api.asc_isDocumentModified();
      } catch (e) {}
      return false;
    };
    if (!modified()) return;
    api.asc_Save(false);
    var deadline = Date.now() + 10000;
    while (modified() && Date.now() < deadline) {
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
    }
  }

  // --- Contacts ----------------------------------------------------------------

  // Changes go to the document straight away (see scripts/contacts.js).
  function createContacts(box) {
    return window.OpenCaseContacts.create({
      box: box,
      store: {
        add: async function (body) {
          try {
            return await Api.post(docPath("/contacts"), { json: body });
          } catch (error) {
            // 409 also means "final": then it is not a duplicate.
            if (error.status === 409 && isFinal()) error.duplicate = false;
            throw error;
          }
        },
        remove: function (contact) {
          return Api.del(docPath("/contacts/" + encodeURIComponent(contact.id)));
        },
        revealAddress: async function (contact) {
          var result = await Api.post(docPath("/contacts/" + encodeURIComponent(contact.id) + "/address"));
          return result && result.address;
        }
      },
      canChange: canChangeContent,
      onChange: updateTabLabels,
      showStatus: showStatus,
      onNotLoggedIn: showLogin,
      errorText: errorText
    });
  }

  async function loadContacts() {
    contactsBox.replaceChildren(element("div", "none", "Henter..."));
    try {
      contacts.set((await Api.get(docPath("/contacts"))) || []);
    } catch (error) {
      contactsBox.replaceChildren(element("div", "none", "Kunne ikke hente afsendere og modtagere: " + errorText(error)));
    }
  }

  // --- Notes -----------------------------------------------------------------------

  function renderNotes() {
    updateTabLabels();
    notesBox.replaceChildren();
    if (!notes.length) {
      notesBox.appendChild(element("div", "none", "Ingen noter"));
      return;
    }
    var list = element("ul", "items");
    notes.forEach(function (note) {
      var li = element("li", "item");
      var body = element("div", "body");
      body.appendChild(element("div", "name", note.title));
      var edited = note.updatedAt && note.updatedAt !== note.createdAt ? " · ændret " + formatDateTime(note.updatedAt) : "";
      body.appendChild(element("div", "sub", (byLine(note.createdAt, note.createdBy) || "") + edited));
      if (note.text) {
        var text = element("div", "note-text");
        text.appendChild(sanitize(note.text, NOTE_TAGS));
        body.appendChild(text);
      }
      li.appendChild(body);

      if (canChangeContent()) {
        var tools = element("div", "tools");
        tools.appendChild(button("Rediger", "button small", function () { openNoteEditor(note); }));
        tools.appendChild(button("Slet", "button small danger", function () { deleteNote(note); }));
        li.appendChild(tools);
      }
      list.appendChild(li);
    });
    notesBox.appendChild(list);
  }

  async function loadNotes() {
    notesBox.replaceChildren(element("div", "none", "Henter..."));
    try {
      notes = (await Api.get(docPath("/notes"))) || [];
      renderNotes();
    } catch (error) {
      notesBox.replaceChildren(element("div", "none", "Kunne ikke hente noter: " + errorText(error)));
    }
  }

  async function deleteNote(note) {
    var ok = await confirmDialog("Slet note", "Er du sikker på, at du vil slette noten “" + note.title + "”?", "Slet");
    if (!ok) return;
    try {
      await Api.del(docPath("/notes/" + encodeURIComponent(note.id)));
      notes = notes.filter(function (n) { return n.id !== note.id; });
      renderNotes();
      showStatus("Noten er slettet.");
    } catch (error) {
      reportError(error);
    }
  }

  // New note (note omitted) or editing one.
  function openNoteEditor(note) {
    openDialog(note ? "Rediger note" : "Ny note", function (box, close) {
      var title = field(box, "Titel *", input());
      title.value = note ? note.title : "";

      box.appendChild(element("label", null, "Tekst"));
      var toolbar = element("div", "toolbar");
      toolbar.setAttribute("role", "toolbar");
      var editor = element("div", "editor");
      editor.contentEditable = "true";
      editor.setAttribute("role", "textbox");
      editor.setAttribute("aria-multiline", "true");
      editor.setAttribute("aria-label", "Tekst");
      if (note && note.text) editor.appendChild(sanitize(note.text, NOTE_TAGS));

      // The formatting the server keeps.
      [["bold", null, "F", "Fed (Ctrl+B)"], ["italic", null, "K", "Kursiv (Ctrl+I)"],
        ["underline", null, "U", "Understreget (Ctrl+U)"], ["strikeThrough", null, "S", "Gennemstreget"],
        ["formatBlock", "<h2>", "H", "Overskrift"], ["formatBlock", "<p>", "¶", "Brødtekst"],
        ["insertUnorderedList", null, "•", "Punktopstilling"], ["insertOrderedList", null, "1.", "Nummereret liste"],
        ["formatBlock", "<blockquote>", "❝", "Citat"]].forEach(function (cmd) {
        var b = element("button", null, cmd[2]);
        b.type = "button";
        b.title = cmd[3];
        b.setAttribute("aria-label", cmd[3]);
        b.addEventListener("mousedown", function (event) { event.preventDefault(); }); // keep the selection
        b.addEventListener("click", function () {
          editor.focus();
          document.execCommand(cmd[0], false, cmd[1]);
        });
        toolbar.appendChild(b);
      });
      box.appendChild(toolbar);
      box.appendChild(editor);

      var error = element("div", "error");
      error.style.marginTop = "10px";
      box.appendChild(error);

      var buttons = element("div", "buttons");
      var save = button("Gem", "button primary", async function () {
        error.textContent = "";
        if (!title.value.trim()) {
          error.textContent = "Skriv en titel.";
          title.focus();
          return;
        }
        var empty = !editor.textContent.trim() && !editor.querySelector("li");
        var body = { title: title.value.trim(), text: empty ? "" : editor.innerHTML };
        save.disabled = true;
        try {
          if (note) {
            var updated = await Api.put(docPath("/notes/" + encodeURIComponent(note.id)), { json: body });
            notes = notes.map(function (n) { return n.id === note.id ? (updated || Object.assign({}, n, body)) : n; });
          } else {
            var created = await Api.post(docPath("/notes"), { json: body });
            notes.unshift(created);
          }
          renderNotes();
          close();
          showStatus(note ? "Noten er gemt." : "Noten er oprettet.");
        } catch (err) {
          save.disabled = false;
          error.textContent = errorText(err);
        }
      });
      buttons.appendChild(button("Annuller", "button", close));
      buttons.appendChild(save);
      box.appendChild(buttons);
    });
  }

  // --- The panel -------------------------------------------------------------------

  function sectionHead(title, buttons) {
    var head = element("div", "section-head");
    head.appendChild(element("h3", null, title));
    (buttons || []).forEach(function (b) { head.appendChild(b); });
    return head;
  }

  // The tab bar; returns { tabId: panel }.
  function renderTabs() {
    var bar = element("div", "tabs");
    bar.setAttribute("role", "tablist");
    var panels = {};
    TABS.forEach(function (tab) {
      var b = element("button", "tab", tab.label);
      b.type = "button";
      b.id = "tab-" + tab.id;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", "panel-" + tab.id);
      b.addEventListener("click", function () { showTab(tab.id); });
      bar.appendChild(b);

      var panel = element("div", "tab-panel");
      panel.id = "panel-" + tab.id;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", b.id);
      panels[tab.id] = panel;
    });
    content.appendChild(bar);
    TABS.forEach(function (tab) { content.appendChild(panels[tab.id]); });
    return panels;
  }

  function showTab(id) {
    activeTab = id;
    TABS.forEach(function (tab) {
      var b = document.getElementById("tab-" + tab.id);
      var panel = document.getElementById("panel-" + tab.id);
      if (!b || !panel) return;
      b.setAttribute("aria-selected", String(tab.id === id));
      panel.hidden = tab.id !== id;
    });
    content.scrollTop = 0;
  }

  // Counts on the tabs, e.g. "Noter (2)".
  function updateTabLabels() {
    var counts = { files: (doc.files || []).length, contacts: contacts ? contacts.count() : 0, notes: notes.length };
    TABS.forEach(function (tab) {
      var b = document.getElementById("tab-" + tab.id);
      if (b) b.textContent = tab.label + (counts[tab.id] ? " (" + counts[tab.id] + ")" : "");
    });
  }

  function render() {
    content.replaceChildren();
    var caseInfo = doc.case || {};
    var file = doc.file || {};

    content.appendChild(renderHeader());
    content.appendChild(element("div", "number", "Dokument " + (doc.documentnumber || "")));
    var panels = renderTabs();

    var details = element("dl");
    var caseLabel = [caseInfo.caseNumber, caseInfo.title].filter(Boolean).join(" — ");
    addRow(details, "Sag", caseInfo.url && caseLabel
      ? linkButton(caseLabel, function () { openUrl(caseInfo.url); })
      : caseLabel);
    addRow(details, "Organisation", caseInfo.organisation);
    addRow(details, "Dokumentkategori", doc.category && doc.category.name);
    addRow(details, "Dokumenttype", doc.documentType);
    addRow(details, "Indsigtsgrad", doc.insightLevel && doc.insightLevel.name);
    addRow(details, "Status", statusControl());
    addRow(details, "Dokumentdato", formatDate(doc.documentDate));
    addRow(details, "Modtaget dato", formatDate(doc.receivedDate));
    addRow(details, "Registreret dato", formatDate(doc.registeredDate));
    addRow(details, "Oprettet", byLine(doc.createdAt, doc.createdBy));
    addRow(details, "Ændret", byLine(doc.updatedAt, doc.updatedBy));
    panels.info.appendChild(details);

    if (doc.summary) {
      panels.info.appendChild(element("h3", null, "Dokumentresume"));
      var summary = element("div", "summary");
      summary.appendChild(sanitize(doc.summary, SUMMARY_TAGS));
      panels.info.appendChild(summary);
    }

    var files = element("ul", "files");
    (doc.files || []).forEach(function (f) {
      var li = document.createElement("li");
      var isCurrent = String(f.fileId) === String(file.fileId || fileId);
      if (isCurrent) {
        li.appendChild(element("span", "current", f.name));
        var meta = ["denne fil", file.version ? "version " + file.version : null, formatSize(file.size),
          file.updatedAt ? "gemt " + formatDateTime(file.updatedAt) : null];
        li.appendChild(element("span", "file-meta", meta.filter(Boolean).join(" · ")));
      } else if (f.editorUrl) {
        li.appendChild(linkButton(f.name, function () { openFile(f); }));
      } else {
        li.appendChild(element("span", null, f.name));
      }
      files.appendChild(li);
    });
    if (!files.children.length) files.appendChild(element("li", "none", "Ingen filer"));
    panels.files.appendChild(files);

    var finalNote = canWrite() && isFinal()
      ? element("div", "locked-note", "Dokumentet er endeligt. Skift status for at ændre afsendere, modtagere og noter.")
      : null;

    // Re-created on each render; keeps the contacts already loaded.
    var loaded = contacts ? contacts.list() : [];
    contactsBox = element("div");
    contacts = createContacts(contactsBox);
    panels.contacts.appendChild(sectionHead("Afsendere og modtagere", canChangeContent() ? contacts.addButtons() : []));
    if (finalNote) panels.contacts.appendChild(finalNote);
    panels.contacts.appendChild(contactsBox);
    contacts.set(loaded);

    panels.notes.appendChild(sectionHead("Noter", canChangeContent() ? [
      button("Ny note", "button small", function () { openNoteEditor(null); })
    ] : []));
    if (finalNote) panels.notes.appendChild(finalNote.cloneNode(true));
    notesBox = element("div");
    panels.notes.appendChild(notesBox);
    renderNotes();

    if (doc.url) {
      var actions = element("div", "actions");
      actions.appendChild(button("Vis i OpenCase", "button primary", function () { openUrl(doc.url); }));
      panels.info.appendChild(actions);
    }

    showTab(activeTab);
    updateTabLabels();
  }

  async function load() {
    if (!fileId) return;
    showStatus("Henter dokumentinformation...");
    try {
      doc = await Api.get("/files/" + encodeURIComponent(fileId) + "/document");
      if (canWrite() && !statuses.length) {
        statuses = (await Api.get("/document-statuses").catch(function () { return []; })) || [];
      }
      render();
      showStatus("");
      loadContacts();
      loadNotes();
    } catch (error) {
      content.replaceChildren();
      if (error instanceof Api.NotLoggedInError) {
        showLogin(error.message);
      } else if (error.status === 404) {
        showStatus("Filen hører ikke til et dokument i OpenCase, eller du har ikke adgang til dokumentet.", true);
      } else {
        showStatus("FEJL: " + error.message, true);
      }
    }
  }

  function showLogin(message) {
    showStatus(message + " (" + window.OpenCaseSettings.getUrl() + ")", true);
    var login = button("Log ind", "button primary", function () {
      login.disabled = true;
      showStatus("Log ind i browseren, og giv adgang. Venter...");
      window.Asc.plugin.sendToPlugin("onLogin", null);
    });
    content.replaceChildren(login);
  }

  window.Asc.plugin.init = function () {
    window.Asc.plugin.sendToPlugin("onDocInfoReady", null);
  };

  // From the main plugin: { fileId } of the open file, or { error }.
  window.Asc.plugin.attachEvent("onShowDocInfo", function (data) {
    if (!data || !data.fileId) {
      showStatus((data && data.error) || "Den åbne fil kunne ikke findes i OpenCase.", true);
      return;
    }
    fileId = data.fileId;
    load();
  });

  window.Asc.plugin.attachEvent("onLoggedIn", load);

  window.Asc.plugin.attachEvent("onLoginFailed", function (data) {
    showLogin("Login fejlede: " + (data && data.error));
  });

  window.Asc.plugin.attachEvent("onDesktopApiTest", function (data) {
    if (data && data.commandExecuted === false) showStatus("FEJL: " + data.error, true);
    else showStatus("");
  });
})(window);
