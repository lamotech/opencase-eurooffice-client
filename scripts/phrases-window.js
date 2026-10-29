// Phrases (Fraser): standard texts a template inserts in place of
// {{fraser.indhold}}. One window for the four ribbon buttons; the main plugin
// sends the mode:
//   new:    Ny frase, the same fields as Opret frase in OpenCase
//   open:   Åbn frase, opens a file phrase in the editor
//   info:   Frase info, shows and changes a phrase (the open one, if the
//           open file is a phrase's file)
//   insert: Indsæt frase, inserts a phrase's text at the cursor
(function (window) {
  var Api = window.OpenCaseApi;
  var P = window.OpenCasePanel;
  var element = P.element;
  var button = P.button;
  var SEARCH_DELAY_MS = 300;
  var UPLOAD_EXTENSIONS = ["docx", "odt"];
  var STATUSES = [
    { value: "draft", label: "Kladde" },
    { value: "active", label: "Aktiv" },
    { value: "archived", label: "Arkiveret" }
  ];
  var SCOPE_TYPES = [
    { value: "casetype", label: "Sagstype" },
    { value: "organisation", label: "Organisation" },
    { value: "kle", label: "KLE-nummer" }
  ];
  // What the server keeps in a phrase's text.
  var TEXT_TAGS = ["P", "BR", "H1", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE",
    "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL"];
  var EDIT_NOTE = "Filen er selve frasen: gemmer du i editoren, ændres frasen for alle. Ændringerne gælder først, " +
    "når alle har lukket filen, så luk den, når du er færdig.";

  var $ = function (id) { return document.getElementById(id); };
  var content = $("content");
  var actions = $("actions");
  var status = $("status");

  var mode = "open";
  var openFileId = null;
  var lists = null; // { categories, caseTypes, organisations }, loaded for the form

  // --- Helpers --------------------------------------------------------------------

  function showStatus(message, problem) {
    status.replaceChildren(document.createTextNode(message || ""));
    status.classList.toggle("problem", !!problem);
  }

  function showLogin(message) {
    showStatus(message + " (" + window.OpenCaseSettings.getUrl() + ")", true);
    var login = button("Log ind", "button primary", function () {
      login.remove();
      showStatus("Log ind i browseren, og giv adgang. Venter...");
      window.Asc.plugin.sendToPlugin("onLogin", null);
    });
    status.appendChild(document.createElement("br"));
    status.appendChild(login);
  }

  function reportError(error, prefix) {
    if (error instanceof Api.NotLoggedInError) {
      showLogin(error.message);
    } else if (error.status === 403) {
      showStatus("Du har ikke rettighed til at oprette eller ændre fraser.", true);
    } else if (error.status === 404) {
      showStatus("Frasen findes ikke længere.", true);
    } else {
      showStatus((prefix || "FEJL: ") + error.message, true);
    }
  }

  function setActions(buttons) {
    actions.replaceChildren.apply(actions, buttons || []);
  }

  function setHeading(text) {
    $("heading").textContent = text;
    document.title = text;
  }

  function sanitize(html, allowed) {
    allowed = allowed || TEXT_TAGS;
    var template = document.createElement("template");
    template.innerHTML = html || "";
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

  function sanitizedHtml(html) {
    var box = element("div");
    box.appendChild(sanitize(html));
    return box.innerHTML;
  }

  function formatDateTime(value) {
    if (!value) return "";
    var date = new Date(value);
    if (isNaN(date)) return value;
    return date.toLocaleString("da-DK", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function byLine(when, who) {
    return [formatDateTime(when), who && who.displayName ? "af " + who.displayName : ""].filter(Boolean).join(" ");
  }

  function statusBadge(phrase) {
    if (phrase.status === "draft") return element("span", "badge draft", "Kladde");
    if (phrase.status === "archived") return element("span", "badge archived", "Arkiveret");
    return null;
  }

  function kindBadge(phrase) {
    return phrase.hasFile
      ? element("span", "badge file", "Fil" + (phrase.fileFormat ? " (" + phrase.fileFormat + ")" : ""))
      : element("span", "badge", "Tekst");
  }

  // The name the editor tab gets; its extension picks the editor.
  function fileName(phrase) {
    return phrase.title + "." + (phrase.fileFormat || "docx");
  }

  function openInEditor(phrase, closeWindow) {
    showStatus("Åbner " + phrase.title + "... " + EDIT_NOTE);
    window.Asc.plugin.sendToPlugin(closeWindow ? "onOpenAndClose" : "onOpenDocument", {
      fileId: phrase.fileId,
      name: fileName(phrase),
      editorUrl: phrase.editorUrl
    });
  }

  // --- The phrase list (Åbn frase, Frase info, Indsæt frase) ---------------------------

  // onPick(phrase, item) is called when a phrase is clicked.
  function showList(options) {
    content.replaceChildren();
    setActions([]);
    if (options.notice) content.appendChild(element("div", "notice", options.notice));

    var row = element("div", "search-row");
    var search = P.input("search");
    search.placeholder = "Søg i titel, beskrivelse og kategori";
    search.setAttribute("aria-label", "Søg i fraser");
    row.appendChild(search);
    var archivedLabel = element("label", "check");
    var archived = P.input("checkbox");
    archivedLabel.appendChild(archived);
    archivedLabel.appendChild(document.createTextNode("Vis arkiverede"));
    if (options.allowArchived) row.appendChild(archivedLabel);
    content.appendChild(row);

    var list = element("div");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Fraser");
    content.appendChild(list);
    var below = element("div");
    content.appendChild(below);

    var timer = null;
    var loadId = 0;

    async function load() {
      var id = ++loadId;
      list.replaceChildren(element("div", "none", "Henter fraser..."));
      try {
        var phrases = await Api.get("/phrases", {
          search: search.value.trim(),
          status: archived.checked ? "draft,active,archived" : options.status
        });
        if (id !== loadId) return;
        render(phrases || []);
        showStatus("");
      } catch (error) {
        if (id !== loadId) return;
        list.replaceChildren();
        reportError(error);
      }
    }

    // Sorted by category path, then title; the path is the group heading.
    function render(phrases) {
      list.replaceChildren();
      below.replaceChildren();
      if (!phrases.length) {
        list.appendChild(element("div", "none", search.value.trim() ? "Ingen fraser matcher søgningen" : "Ingen fraser"));
        return;
      }
      var group = null;
      phrases.forEach(function (phrase) {
        var path = phrase.categoryPath || "Uden kategori";
        if (path !== group) {
          group = path;
          list.appendChild(element("div", "group", path));
        }
        var item = element("div", "phrase");
        item.setAttribute("role", "option");
        item.tabIndex = 0;
        var title = element("div", "title", phrase.title);
        [statusBadge(phrase), kindBadge(phrase)].forEach(function (badge) { if (badge) title.appendChild(badge); });
        item.appendChild(title);
        if (phrase.description) item.appendChild(element("div", "sub", phrase.description));
        item.addEventListener("click", function (event) {
          if (event.target.closest(".choice")) return; // buttons inside the item
          list.querySelectorAll(".phrase").forEach(function (p) { p.setAttribute("aria-selected", "false"); });
          item.setAttribute("aria-selected", "true");
          options.onPick(phrase, item, below);
        });
        item.addEventListener("keydown", function (event) {
          if (event.key === "Enter") item.click();
        });
        list.appendChild(item);
      });
    }

    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(load, SEARCH_DELAY_MS);
    });
    archived.addEventListener("change", load);
    search.focus();
    return load();
  }

  // --- Åbn frase ---------------------------------------------------------------------

  function showOpen() {
    setHeading("Åbn frase");
    showList({
      status: "draft,active",
      allowArchived: true,
      notice: EDIT_NOTE,
      onPick: function (phrase, item) {
        item.querySelectorAll(".choice").forEach(function (c) { c.remove(); });
        if (phrase.hasFile && phrase.editorUrl) {
          openInEditor(phrase, false);
          return;
        }
        if (phrase.hasFile) {
          showStatus("Du har ikke adgang til at redigere frasens fil.", true);
          return;
        }
        // A text phrase has no file: edit its text here, or give it a file.
        var choice = element("div", "choice");
        choice.appendChild(element("span", "sub", "Frasen har kun tekst, ingen fil."));
        choice.appendChild(button("Rediger teksten", "button small", function () {
          showInfo(phrase.id, showOpen);
        }));
        var make = button("Opret fil og åbn", "button small primary", async function () {
          make.disabled = true;
          try {
            var updated = await createBlankFile(phrase.id);
            openInEditor(updated, false);
          } catch (error) {
            make.disabled = false;
            reportError(error);
          }
        });
        make.title = "Frasen får en tom fil, som bruges i stedet for teksten";
        choice.appendChild(make);
        item.appendChild(choice);
      }
    });
  }

  // POST /phrases/{id}/file { blank: true }; returns the phrase with editorUrl.
  async function createBlankFile(id) {
    showStatus("Opretter filen...");
    var result = await Api.post("/phrases/" + encodeURIComponent(id) + "/file", { json: { blank: true } });
    if (!result || !result.editorUrl) {
      result = await Api.get("/phrases/" + encodeURIComponent(id));
    }
    if (!result || !result.editorUrl) throw new Error("Filen er oprettet, men kan ikke åbnes herfra.");
    return result;
  }

  // --- Indsæt frase ------------------------------------------------------------------

  function showInsert() {
    setHeading("Indsæt frase");
    showList({
      status: "draft,active",
      allowArchived: false,
      onPick: async function (phrase, item, below) {
        below.replaceChildren(element("div", "none", "Henter frasens tekst..."));
        setActions([]);
        try {
          var text = await Api.get("/phrases/" + encodeURIComponent(phrase.id) + "/content");
          await addFileFormatting(text, below);
          renderPreview(text, below);
        } catch (error) {
          below.replaceChildren();
          reportError(error);
        }
      }
    });
  }

  // For a file phrase the server's html is only the file's text, paragraph by
  // paragraph. To keep headings, bold, lists and tables, fetch the .docx and
  // convert it here (resources/vendor/mammoth). Sets phrase.formattedHtml.
  // On failure the server's text is used, and phrase.formatProblem says why.
  // Also keeps the file itself (phrase.fileBytes), which the editor can insert
  // exactly as it is (see insertFileExactly).
  async function addFileFormatting(phrase, box) {
    if (phrase.source !== "file") return;
    if (phrase.fileFormat !== "docx" && phrase.fileFormat !== "odt") {
      phrase.formatProblem = "Kun .docx- og .odt-filer kan indsættes med formatering.";
      return;
    }
    box.replaceChildren(element("div", "none", "Henter frasens fil..."));
    try {
      var blob = await Api.getBlob(filePath(phrase));
      phrase.fileBytes = await blob.arrayBuffer();
      if (phrase.fileFormat !== "docx" || !window.mammoth) return; // mammoth reads .docx only
      var result = await window.mammoth.convertToHtml({ arrayBuffer: phrase.fileBytes.slice(0) });
      if (result && result.value && result.value.trim()) phrase.formattedHtml = result.value;
    } catch (error) {
      if (error instanceof Api.NotLoggedInError) throw error;
      console.warn("OpenCase: phrase file could not be converted", error);
      phrase.formatProblem = "Filen kunne ikke hentes eller læses (" + error.message + ").";
    }
  }

  // fileUrl points into the desktop API; request it through api.js, which
  // adds the login.
  function filePath(phrase) {
    var match = /\/desktop\/v1\/api(\/.+)$/.exec(phrase.fileUrl || "");
    return match ? match[1] : "/phrases/" + encodeURIComponent(phrase.id) + "/file";
  }

  // The Word editor's own "Indsæt → Tekst fra fil": the Document Server converts
  // the file and pastes it at the cursor with all its formatting (fonts,
  // colours, sizes, tables, images). Only in documents served by the Document
  // Server: the desktop app's local editor converts files from disk only.
  function editorForExactInsert() {
    try {
      var parent = window.parent;
      var api = parent.Asc && parent.Asc.editor;
      var Manager = parent.AscCommonWord && parent.AscCommonWord.CInsertDocumentManager;
      if (!api || !Manager || !api.WordControl) return null; // Word editor only
      if (typeof api.isLocalMode === "function" && api.isLocalMode()) return null;
      return { parent: parent, api: api, Manager: Manager };
    } catch (e) {
      return null; // the editor frame can't be reached
    }
  }

  // Resolves when the editor has finished (or given up: it shows its own error).
  function insertFileExactly(editor, phrase) {
    return new Promise(function (resolve) {
      var manager = new editor.Manager(editor.api);
      var end = manager.endLongAction;
      manager.endLongAction = function () {
        end.apply(this, arguments);
        resolve();
      };
      setTimeout(resolve, 60000); // don't wait forever on a conversion that never reports back
      manager.startLongAction();
      // The bytes are copied into the editor's frame, so the insert doesn't
      // depend on this window once it is closed.
      var data = new editor.parent.Uint8Array(phrase.fileBytes.byteLength);
      data.set(new Uint8Array(phrase.fileBytes));
      manager.convertDocuments([{ data: data, format: phrase.fileFormat }]);
    });
  }

  // The preview also shows tables from a converted file.
  var PREVIEW_TAGS = TEXT_TAGS.concat(["TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "SUP", "SUB"]);

  function renderPreview(phrase, box) {
    box.replaceChildren();
    var preview = element("div", "preview");
    var title = element("div", "label", phrase.title);
    var badge = statusBadge(phrase);
    if (badge) title.appendChild(badge);
    preview.appendChild(title);
    var body = element("div", "body");
    body.appendChild(sanitize(phrase.formattedHtml || phrase.html || "", PREVIEW_TAGS));
    if (!body.childNodes.length) body.textContent = phrase.text || "";
    preview.appendChild(body);
    box.appendChild(preview);

    var notes = [];
    var exact = phrase.fileBytes ? editorForExactInsert() : null;
    if (exact) {
      notes.push("Frasen er en fil og indsættes præcis som i filen, med skrifttyper, farver og størrelser. " +
        "Forhåndsvisningen her viser kun teksten.");
    } else if (phrase.formattedHtml) {
      notes.push("Frasen er en fil og indsættes med filens formatering (overskrifter, fed, lister og tabeller). " +
        "Skrifttyper og farver kan afvige, fordi dokumentet ikke er åbnet fra OpenCase.");
    } else if (phrase.source === "file") {
      notes.push("Frasen er en fil. Teksten indsættes uden filens formatering." +
        (phrase.formatProblem ? " " + phrase.formatProblem : ""));
    }
    if (phrase.status === "draft") notes.push("Frasen er en kladde og indsættes ikke i breve, før den er aktiv.");
    notes.push("Flettefelter i frasen indsættes, som de er, og udfyldes, når der oprettes en fil fra skabelonen.");
    box.appendChild(element("div", "hint", notes.join(" ")));
    box.scrollIntoView({ block: "nearest" });

    var insert = button("Indsæt", "button primary", async function () {
      if (exact) {
        insert.disabled = true;
        showStatus("Indsætter frasen...");
        await insertFileExactly(exact, phrase);
        window.Asc.plugin.sendToPlugin("onPhraseInserted", null);
        return;
      }
      window.Asc.plugin.sendToPlugin("onInsertPhrase", {
        // The converted file is made here, from the phrase's own .docx.
        html: phrase.formattedHtml || sanitizedHtml(phrase.html || ""),
        text: phrase.text || ""
      });
    });
    setActions([insert]);
    showStatus("");
  }

  // --- Frase info ----------------------------------------------------------------------

  // The open file may be a phrase's file: then show that phrase straight away.
  async function showInfoStart() {
    setHeading("Frase info");
    if (openFileId) {
      showStatus("Henter...");
      try {
        var all = await Api.get("/phrases", { status: "draft,active,archived" });
        var match = (all || []).find(function (p) { return String(p.fileId) === String(openFileId); });
        if (match) {
          await showInfo(match.id, showInfoList);
          return;
        }
      } catch (error) {
        if (error instanceof Api.NotLoggedInError) {
          showLogin(error.message);
          return;
        }
      }
    }
    showInfoList();
  }

  function showInfoList() {
    setHeading("Frase info");
    showList({
      status: "draft,active",
      allowArchived: true,
      notice: "Den åbne fil er ikke en frase. Vælg den frase, du vil se.",
      onPick: function (phrase) { showInfo(phrase.id, showInfoList); }
    });
  }

  async function showInfo(id, back) {
    content.replaceChildren();
    setActions([]);
    showStatus("Henter frasen...");
    try {
      var results = await Promise.all([Api.get("/phrases/" + encodeURIComponent(id)), loadLists()]);
      setHeading("Frase info");
      showForm(results[0], back);
      showStatus("");
    } catch (error) {
      reportError(error);
      if (back) setActions([button("Tilbage", "button", back)]);
    }
  }

  // --- The phrase form (Ny frase, and changing one) -------------------------------------

  async function loadLists() {
    if (lists) return lists;
    var results = await Promise.all([
      Api.get("/phrase-categories"),
      Api.get("/case-types"),
      Api.get("/organisations")
    ]);
    lists = { categories: results[0] || [], caseTypes: results[1] || [], organisations: results[2] || [] };
    return lists;
  }

  function labelled(labelText, control, required) {
    var wrap = element("div", "field");
    var label = element("label", required ? "required" : null, labelText);
    control.id = control.id || "f-" + Math.random().toString(36).slice(2);
    label.htmlFor = control.id;
    wrap.appendChild(label);
    wrap.appendChild(control);
    return wrap;
  }

  function richTextEditor(html) {
    var wrap = element("div");
    var toolbar = element("div", "toolbar");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Formatering");
    var editor = element("div", "editor");
    editor.contentEditable = "true";
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    editor.setAttribute("aria-label", "Tekst");
    if (html) editor.appendChild(sanitize(html));
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
    wrap.appendChild(toolbar);
    wrap.appendChild(editor);
    return {
      element: wrap,
      html: function () {
        var empty = !editor.textContent.trim() && !editor.querySelector("li");
        return empty ? "" : editor.innerHTML;
      }
    };
  }

  // Afgrænsning: case types, organisations and KLE numbers.
  function scopeEditor(initial) {
    var scopes = (initial || []).map(function (s) { return { type: s.type, value: String(s.value), label: s.label }; });
    var wrap = element("div");
    var chips = element("div", "scopes");
    wrap.appendChild(chips);

    var add = element("div", "scope-add");
    var type = document.createElement("select");
    type.setAttribute("aria-label", "Type af afgrænsning");
    SCOPE_TYPES.forEach(function (t) { type.add(new Option(t.label, t.value)); });
    add.appendChild(type);
    var valueBox = element("div", "value");
    add.appendChild(valueBox);
    var addButton = button("Tilføj", "button small", addScope);
    add.appendChild(addButton);
    wrap.appendChild(add);

    var value = null;

    function typeLabel(t) {
      return (SCOPE_TYPES.find(function (s) { return s.value === t; }) || {}).label || t;
    }

    function scopeLabel(s) {
      if (s.label) return s.label;
      if (s.type === "casetype") {
        var ct = lists.caseTypes.find(function (c) { return String(c.id) === s.value; });
        return ct ? ct.name : s.value;
      }
      if (s.type === "organisation") {
        var org = lists.organisations.find(function (o) { return o.uuid === s.value; });
        return org ? org.name : s.value;
      }
      return s.value;
    }

    function buildValue() {
      if (type.value === "kle") {
        value = P.input("text");
        value.placeholder = "F.eks. 00.01";
      } else {
        value = document.createElement("select");
        if (type.value === "casetype") {
          lists.caseTypes.forEach(function (c) { value.add(new Option(c.name, String(c.id))); });
        } else {
          lists.organisations.forEach(function (o) {
            value.add(new Option("  ".repeat(Number(o.depth) || 0) + o.name, o.uuid));
          });
        }
      }
      value.style.width = "100%";
      value.setAttribute("aria-label", typeLabel(type.value));
      valueBox.replaceChildren(value);
    }

    function addScope() {
      var v = value.value.trim();
      if (!v) return;
      if (scopes.some(function (s) { return s.type === type.value && s.value === v; })) return;
      scopes.push({ type: type.value, value: v });
      render();
      if (type.value === "kle") value.value = "";
    }

    function render() {
      chips.replaceChildren();
      if (!scopes.length) {
        chips.appendChild(element("span", "hint", "Ingen afgrænsning: frasen kan bruges i alle sager."));
      }
      scopes.forEach(function (s) {
        var chip = element("span", "scope", typeLabel(s.type) + ": " + scopeLabel(s));
        var x = element("button", null, "×");
        x.type = "button";
        x.setAttribute("aria-label", "Fjern " + chip.textContent);
        x.addEventListener("click", function () {
          scopes = scopes.filter(function (other) { return other !== s; });
          render();
        });
        chip.appendChild(x);
        chips.appendChild(chip);
      });
    }

    type.addEventListener("change", buildValue);
    buildValue();
    render();
    return {
      element: wrap,
      values: function () { return scopes.map(function (s) { return { type: s.type, value: s.value }; }); }
    };
  }

  function uploadExtension(fileInput) {
    var file = fileInput.files[0];
    if (!file) return "";
    var dot = file.name.lastIndexOf(".");
    return dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  }

  // phrase null: Ny frase. back: return to the list (Frase info, Åbn frase).
  function showForm(phrase, back) {
    var isNew = !phrase;
    content.replaceChildren();

    if (!isNew) {
      var head = element("div", "label", phrase.title);
      [statusBadge(phrase), kindBadge(phrase)].forEach(function (badge) { if (badge) head.appendChild(badge); });
      head.style.fontSize = "15px";
      head.style.marginBottom = "10px";
      content.appendChild(head);
      if (phrase.canEdit === false) {
        content.appendChild(element("div", "notice", "Du kan se frasen, men ikke ændre den."));
      }
    }

    var title = P.input("text");
    title.value = phrase ? phrase.title || "" : "";
    content.appendChild(labelled("Titel", title, true));

    var description = P.input("text");
    description.value = phrase ? phrase.description || "" : "";
    var descriptionField = labelled("Beskrivelse", description);
    descriptionField.appendChild(element("div", "hint", "Kort beskrivelse af, hvornår frasen bruges"));
    content.appendChild(descriptionField);

    var row = element("div", "row");
    var category = document.createElement("select");
    category.add(new Option("Ingen kategori", ""));
    lists.categories.forEach(function (c) {
      category.add(new Option("   ".repeat(Number(c.depth) || 0) + c.name, String(c.id)));
    });
    category.value = phrase && phrase.categoryId != null ? String(phrase.categoryId) : "";
    row.appendChild(labelled("Kategori", category));

    var statusSelect = document.createElement("select");
    STATUSES.forEach(function (s) { statusSelect.add(new Option(s.label, s.value)); });
    statusSelect.value = phrase ? phrase.status || "draft" : "draft";
    var statusField = labelled("Status", statusSelect);
    statusField.appendChild(element("div", "hint", "Kun aktive fraser kommer med i breve."));
    row.appendChild(statusField);
    content.appendChild(row);

    var text = richTextEditor(phrase ? phrase.content : "");
    var textField = element("div", "field");
    textField.appendChild(element("span", "label", "Tekst"));
    textField.appendChild(text.element);
    var textHint = element("div", "hint");
    textField.appendChild(textHint);
    content.appendChild(textField);

    var scopeField = element("div", "field");
    scopeField.appendChild(element("span", "label", "Afgrænsning"));
    var scopes = scopeEditor(phrase ? phrase.scopes : []);
    scopeField.appendChild(scopes.element);
    scopeField.appendChild(element("div", "hint", "Begrænser, hvor frasen kan bruges: sagstyper, organisationer og KLE-numre."));
    content.appendChild(scopeField);

    // Frasefil
    var fileField = element("div", "field");
    fileField.appendChild(element("span", "label", "Frasefil"));
    var fileInput = P.input("file");
    fileInput.accept = ".docx,.odt";
    var fileMode = null;
    if (isNew) {
      // A blank file to write in the editor is the natural choice here.
      var choice = element("div", "file-choice");
      [["blank", "Tom fil – skriv frasen i editoren"], ["upload", "Upload en .docx- eller .odt-fil"],
        ["none", "Ingen fil – brug teksten ovenfor"]].forEach(function (option, index) {
        var label = element("label", "check");
        var radio = P.input("radio");
        radio.name = "file-mode";
        radio.value = option[0];
        radio.checked = index === 0;
        label.appendChild(radio);
        label.appendChild(document.createTextNode(option[1]));
        choice.appendChild(label);
      });
      fileField.appendChild(choice);
      fileInput.hidden = true;
      fileField.appendChild(fileInput);
      fileMode = function () { return choice.querySelector("input:checked").value; };
      var updateMode = function () {
        fileInput.hidden = fileMode() !== "upload";
        textHint.textContent = fileMode() === "none" ? "" : "Har frasen en fil, bruges filen i stedet for teksten.";
      };
      choice.addEventListener("change", updateMode);
      updateMode();
    } else {
      fileField.appendChild(fileActions(phrase, fileInput, back));
      textHint.textContent = phrase.hasFile ? "Frasen har en fil, som bruges i stedet for teksten." : "";
    }
    content.appendChild(fileField);

    if (!isNew) {
      content.appendChild(element("span", "label", "Bruges i skabeloner"));
      var templates = element("ul", "templates-list");
      (phrase.templates || []).forEach(function (t) {
        var li = element("li", null, t.name);
        var flags = [t.isRequired ? "obligatorisk" : "", t.isDefault ? "forudvalgt" : ""].filter(Boolean);
        if (flags.length) li.appendChild(element("span", "hint", " (" + flags.join(", ") + ")"));
        if (t.matchesOrgs === false) {
          li.appendChild(element("span", "mismatch", "Afgrænsningen passer ikke til skabelonens organisationer"));
        }
        templates.appendChild(li);
      });
      if (!templates.children.length) templates.appendChild(element("li", "hint", "Ingen"));
      content.appendChild(templates);
      var meta = ["Oprettet " + byLine(phrase.createdAt, phrase.createdBy)];
      if (phrase.updatedAt) meta.push("Ændret " + byLine(phrase.updatedAt, phrase.updatedBy));
      content.appendChild(element("div", "meta", meta.join(" · ")));
    }

    var canEdit = isNew || phrase.canEdit !== false;
    if (!canEdit) {
      content.querySelectorAll("input, select, button").forEach(function (c) { c.disabled = true; });
      content.querySelectorAll("[contenteditable]").forEach(function (c) { c.contentEditable = "false"; });
    }

    var saveButton = button(isNew ? "Opret" : "Gem", "button primary", function () { submit(); });
    var buttons = [];
    if (back) buttons.push(button("Tilbage", "button", back));
    if (canEdit) buttons.push(saveButton);
    setActions(buttons);
    if (canEdit) title.focus();

    function fields() {
      return {
        title: title.value.trim(),
        description: description.value.trim(),
        content: text.html(),
        categoryId: category.value ? Number(category.value) : null,
        status: statusSelect.value,
        scopes: scopes.values()
      };
    }

    async function submit() {
      var body = fields();
      if (!body.title) {
        showStatus("Skriv en titel.", true);
        title.focus();
        return;
      }
      var modeValue = isNew ? fileMode() : null;
      if (modeValue === "upload") {
        if (!fileInput.files[0]) {
          showStatus("Vælg den fil, der skal uploades.", true);
          return;
        }
        if (UPLOAD_EXTENSIONS.indexOf(uploadExtension(fileInput)) < 0) {
          showStatus("Frasefilen skal være en .docx- eller .odt-fil.", true);
          return;
        }
      }
      saveButton.disabled = true;
      showStatus(isNew ? "Opretter frasen..." : "Gemmer...");
      try {
        var result;
        if (!isNew) {
          // Only the fields sent are changed; scopes replaces all scopes.
          result = await Api.put("/phrases/" + encodeURIComponent(phrase.id), { json: body });
          showForm(result || Object.assign({}, phrase, body), back);
          showStatus("Frasen er gemt.");
          return;
        }
        if (modeValue === "upload") {
          var form = new FormData();
          Object.keys(body).forEach(function (key) {
            if (key === "scopes") form.append("scopes", JSON.stringify(body.scopes));
            else if (body[key] !== null && body[key] !== "") form.append(key, body[key]);
          });
          var file = fileInput.files[0];
          form.append("file", file, file.name);
          result = await Api.post("/phrases", { form: form });
        } else {
          if (modeValue === "blank") body.blankFile = true;
          result = await Api.post("/phrases", { json: body });
        }

        if (result && result.fileError) {
          // The phrase exists; its file can be added again from its page.
          showForm(result, null);
          showStatus("Frasen er oprettet, men filen kunne ikke gemmes: " + result.fileError +
            " Prøv at tilføje filen igen under Frasefil.", true);
        } else if (modeValue === "blank" && result && result.editorUrl) {
          openInEditor(result, true);
        } else {
          showForm(result, null);
          showStatus("Frasen “" + result.title + "” er oprettet.");
        }
      } catch (error) {
        saveButton.disabled = false;
        // 400: the server's text says what is wrong.
        reportError(error, error.status === 400 ? "" : "FEJL: ");
      }
    }
  }

  // A saved phrase's file: open it, replace it, or give a text phrase one.
  function fileActions(phrase, fileInput, back) {
    var box = element("div");
    box.appendChild(element("div", "hint", phrase.hasFile
      ? "Frasen har en fil" + (phrase.fileFormat ? " (" + phrase.fileFormat + ")" : "") + "."
      : "Frasen har ingen fil."));
    var row = element("div", "file-actions");
    if (phrase.hasFile && phrase.editorUrl) {
      row.appendChild(button("Åbn filen", "button small primary", function () { openInEditor(phrase, false); }));
    }
    if (!phrase.hasFile) {
      var blank = button("Opret tom fil og åbn", "button small", async function () {
        blank.disabled = true;
        try {
          openInEditor(await createBlankFile(phrase.id), false);
        } catch (error) {
          blank.disabled = false;
          reportError(error);
        }
      });
      row.appendChild(blank);
    }
    row.appendChild(fileInput);
    var upload = button(phrase.hasFile ? "Erstat med fil" : "Upload fil", "button small", async function () {
      if (!fileInput.files[0]) {
        showStatus("Vælg en .docx- eller .odt-fil først.", true);
        return;
      }
      if (UPLOAD_EXTENSIONS.indexOf(uploadExtension(fileInput)) < 0) {
        showStatus("Frasefilen skal være en .docx- eller .odt-fil.", true);
        return;
      }
      upload.disabled = true;
      showStatus("Uploader filen...");
      try {
        var form = new FormData();
        form.append("file", fileInput.files[0], fileInput.files[0].name);
        await Api.post("/phrases/" + encodeURIComponent(phrase.id) + "/file", { form: form });
        await showInfo(phrase.id, back);
        showStatus("Filen er gemt på frasen.");
      } catch (error) {
        upload.disabled = false;
        reportError(error);
      }
    });
    row.appendChild(upload);
    box.appendChild(row);
    return box;
  }

  async function showNew() {
    setHeading("Ny frase");
    content.replaceChildren();
    showStatus("Henter...");
    try {
      await loadLists();
      showForm(null, null);
      showStatus("");
    } catch (error) {
      reportError(error);
    }
  }

  // --- Start ---------------------------------------------------------------------------

  function start() {
    if (mode === "new") return showNew();
    if (mode === "info") return showInfoStart();
    if (mode === "insert") return showInsert();
    return showOpen();
  }

  window.Asc.plugin.init = function () {
    window.Asc.plugin.sendToPlugin("onPhrasesReady", null);
  };

  // From the main plugin: { mode, fileId }.
  window.Asc.plugin.attachEvent("onShowPhrases", function (data) {
    mode = (data && data.mode) || "open";
    openFileId = data && data.fileId;
    start();
  });

  window.Asc.plugin.attachEvent("onLoggedIn", start);

  window.Asc.plugin.attachEvent("onLoginFailed", function (data) {
    showLogin("Login fejlede: " + (data && data.error));
  });

  window.Asc.plugin.attachEvent("onDesktopApiTest", function (data) {
    if (data && data.commandExecuted === false) showStatus("FEJL: " + data.error, true);
  });
})(window);
