// "Send link med email" and "Send PDF med email": sends the open file's
// document through the user's account in the Nextcloud Mail app, as a link
// (POST /documents/{id}/email/link) or with its files as PDF attachments
// (POST /documents/{id}/email/pdf). The main plugin sends the variant.
(function (window) {
  var Api = window.OpenCaseApi;
  var S = window.OpenCaseSend;
  var element = S.element;
  var SEARCH_DELAY_MS = 300;
  var MIN_SEARCH_LENGTH = 2;
  var EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
  var NO_ACCOUNT = "Der er ikke konfigureret en e-mailkonto i Mail-appen. Opret venligst en e-mailkonto i Mail-appen først.";

  var $ = function (id) { return document.getElementById(id); };
  var form = $("form");
  var subject = $("subject");
  var message = $("message");
  var sendButton = $("send");

  var fileId = null;
  var variant = "link"; // link | pdf
  var doc = null;
  var fields = {};      // to / cc / bcc → recipient field
  var sending = false;
  var sent = false;

  function docPath(suffix) {
    return "/documents/" + encodeURIComponent(doc.id) + suffix;
  }

  function isLink() {
    return variant === "link";
  }

  // --- Recipient fields ----------------------------------------------------------

  // A chip input: search results from GET /documents/{id}/email/recipients,
  // or an address typed by the user ({ email, name }).
  function createRecipientField(container, name) {
    var chosen = [];
    var chips = element("div", "chips");
    var input = document.createElement("input");
    input.type = "text";
    input.id = name + "-input";
    input.autocomplete = "off";
    input.placeholder = "Søg på navn, eller skriv en e-mailadresse";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    chips.appendChild(input);
    var list = element("ul", "suggestions");
    list.hidden = true;
    list.setAttribute("role", "listbox");
    container.appendChild(chips);
    container.appendChild(list);

    var options = [];
    var active = -1;
    var timer = null;
    var searchId = 0;

    chips.addEventListener("click", function () { input.focus(); });

    function key(r) {
      return (r.email || "").toLowerCase();
    }

    function add(recipient) {
      if (!recipient || !recipient.email) return;
      if (chosen.some(function (r) { return key(r) === key(recipient); })) return;
      chosen.push(recipient);
      render();
    }

    function remove(recipient) {
      chosen = chosen.filter(function (r) { return r !== recipient; });
      render();
    }

    function render() {
      chips.querySelectorAll(".chip").forEach(function (chip) { chip.remove(); });
      chosen.forEach(function (r) {
        var noAccess = isLink() && r.documentAccess !== true && r.documentAccess !== undefined;
        var chip = element("span", "chip" + (noAccess ? " no-access" : ""));
        var label = r.name && r.name !== r.email ? r.name + " <" + r.email + ">" : r.email;
        chip.appendChild(document.createTextNode(label));
        if (noAccess) chip.title = "Kan ikke åbne linket til dokumentet";
        var x = element("button", null, "×");
        x.type = "button";
        x.setAttribute("aria-label", "Fjern " + label);
        x.addEventListener("click", function (event) {
          event.stopPropagation();
          remove(r);
          input.focus();
        });
        chip.appendChild(x);
        chips.insertBefore(chip, input);
      });
    }

    // A typed address becomes a recipient on Enter, comma, semicolon or blur.
    function commitTyped() {
      var text = input.value.trim().replace(/[,;]$/, "").trim();
      if (!text) return true;
      // "Name <address>" or just the address.
      var match = /^(.*)<([^>]+)>$/.exec(text);
      var email = (match ? match[2] : text).trim();
      var label = match ? match[1].trim().replace(/^"|"$/g, "") : "";
      if (!EMAIL_PATTERN.test(email)) return false;
      add({ email: email, name: label || email, typed: true });
      input.value = "";
      close();
      return true;
    }

    input.addEventListener("input", function () {
      clearTimeout(timer);
      var text = input.value.trim();
      if (/[,;]$/.test(input.value)) {
        commitTyped();
        return;
      }
      if (text.length < MIN_SEARCH_LENGTH) {
        close();
        return;
      }
      timer = setTimeout(function () { search(text); }, SEARCH_DELAY_MS);
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (list.hidden || !options.length) return;
        event.preventDefault();
        active = (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        highlight();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (!list.hidden && active >= 0) {
          pick(options[active]);
        } else if (!commitTyped()) {
          S.showStatus("“" + input.value.trim() + "” er ikke en gyldig e-mailadresse.", true);
        }
      } else if (event.key === "Escape") {
        close();
      } else if (event.key === "Backspace" && !input.value && chosen.length) {
        remove(chosen[chosen.length - 1]);
      }
    });

    input.addEventListener("blur", function () {
      // Let a click on a suggestion land first.
      setTimeout(function () {
        close();
        commitTyped();
      }, 150);
    });

    async function search(text) {
      var id = ++searchId;
      showMessage("Søger...");
      try {
        var results = await Api.get(docPath("/email/recipients"), { q: text });
        if (id !== searchId) return;
        options = (results || []).filter(function (r) { return r && r.email; });
        active = -1;
        list.replaceChildren();
        if (!options.length) {
          showMessage(EMAIL_PATTERN.test(text) ? "Tryk Enter for at bruge " + text : "Ingen fundet");
          return;
        }
        options.forEach(function (r, index) {
          var li = element("li", "suggestion", r.name || r.email);
          li.setAttribute("role", "option");
          li.id = name + "-option-" + index;
          var sub = [r.email, typeLabel(r.type)];
          if (isLink() && r.documentAccess === false) sub.push("har ikke adgang til dokumentet");
          li.appendChild(element("div", "sub", sub.filter(Boolean).join(" · ")));
          // mousedown, so it fires before the input's blur.
          li.addEventListener("mousedown", function (event) {
            event.preventDefault();
            pick(r);
          });
          list.appendChild(li);
        });
        open();
      } catch (error) {
        if (id !== searchId) return;
        close();
        S.reportError(error);
      }
    }

    function pick(r) {
      // Sent back as it is.
      add(r);
      input.value = "";
      close();
      input.focus();
    }

    function showMessage(text) {
      options = [];
      active = -1;
      list.replaceChildren(element("li", "suggestion message", text));
      open();
    }

    function highlight() {
      Array.prototype.forEach.call(list.children, function (li, i) {
        li.classList.toggle("active", i === active);
      });
      var li = list.children[active];
      if (li) {
        input.setAttribute("aria-activedescendant", li.id);
        li.scrollIntoView({ block: "nearest" });
      }
    }

    function open() {
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    return {
      input: input,
      commit: commitTyped,
      values: function () { return chosen.slice(); },
      update: render
    };
  }

  function typeLabel(type) {
    return { user: "Bruger", organisation: "Organisation", participant: "Sagspart", contact: "Dokumentkontakt" }[type] || "";
  }

  // The recipient as the server wants it back: search results as they are,
  // typed addresses as { email, name }.
  function payload(r) {
    if (r.typed) return { email: r.email, name: r.name };
    var copy = Object.assign({}, r);
    delete copy.typed;
    return copy;
  }

  // --- Message editor ------------------------------------------------------------

  // The formatting the server keeps: paragraphs, headings, lists, bold,
  // italic, underline and strike-through.
  function buildToolbar() {
    var toolbar = $("toolbar");
    [["bold", null, "F", "Fed (Ctrl+B)"], ["italic", null, "K", "Kursiv (Ctrl+I)"],
      ["underline", null, "U", "Understreget (Ctrl+U)"], ["strikeThrough", null, "S", "Gennemstreget"],
      ["formatBlock", "<h2>", "H", "Overskrift"], ["formatBlock", "<p>", "¶", "Brødtekst"],
      ["insertUnorderedList", null, "•", "Punktopstilling"], ["insertOrderedList", null, "1.", "Nummereret liste"]
    ].forEach(function (cmd) {
      var b = element("button", null, cmd[2]);
      b.type = "button";
      b.title = cmd[3];
      b.setAttribute("aria-label", cmd[3]);
      b.addEventListener("mousedown", function (event) { event.preventDefault(); }); // keep the selection
      b.addEventListener("click", function () {
        message.focus();
        document.execCommand(cmd[0], false, cmd[1]);
      });
      toolbar.appendChild(b);
    });
  }

  function messageHtml() {
    var empty = !message.textContent.trim() && !message.querySelector("li");
    return empty ? "" : message.innerHTML;
  }

  // --- Files (PDF variant) ---------------------------------------------------------

  // fileIds are OpenCase's file ids, as in the Digital Post draft (`id`),
  // not the Nextcloud file ids (`fileId`) in the document info.
  async function loadFiles() {
    var draft = await Api.get(docPath("/digital-post/draft"));
    return (draft && draft.files) || [];
  }

  function renderFiles(files) {
    var box = $("files");
    box.replaceChildren();
    if (!files.length) {
      box.appendChild(element("div", "muted", "Dokumentet har ingen filer."));
      return;
    }
    files.forEach(function (file) {
      var label = element("label", "check");
      var check = document.createElement("input");
      check.type = "checkbox";
      check.checked = true; // all ticked from the start
      check.value = String(file.id);
      label.appendChild(check);
      label.appendChild(document.createTextNode(file.name));
      box.appendChild(label);
    });
  }

  function checkedFileIds() {
    return Array.prototype.map.call($("files").querySelectorAll("input:checked"), function (box) {
      return Number(box.value);
    });
  }

  // --- Sending ----------------------------------------------------------------------

  function confirmDialog(title, text, okText) {
    return new Promise(function (resolve) {
      var overlay = element("div", "overlay");
      var box = element("div", "confirm");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.appendChild(element("h4", null, title));
      box.appendChild(element("p", null, text));
      var buttons = element("div", "buttons");
      function done(result) {
        overlay.remove();
        resolve(result);
      }
      buttons.appendChild(S.button("Annuller", "button", function () { done(false); }));
      var ok = S.button(okText, "button primary", function () { done(true); });
      buttons.appendChild(ok);
      box.appendChild(buttons);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      ok.focus();
    });
  }

  // The link only works for OpenCase users who can read the document.
  // Typed addresses are checked with POST /documents/{id}/email/access.
  async function recipientsWithoutAccess(all) {
    var typed = all.filter(function (r) { return r.typed; });
    if (typed.length) {
      var answer = await Api.post(docPath("/email/access"), { json: {
        emails: typed.map(function (r) { return r.email; })
      } });
      (answer || []).forEach(function (entry) {
        typed.forEach(function (r) {
          if (r.email.toLowerCase() === String(entry.email).toLowerCase()) r.documentAccess = entry.documentAccess;
        });
      });
      ["to", "cc", "bcc"].forEach(function (f) { fields[f].update(); });
    }
    return all.filter(function (r) { return r.documentAccess !== true; });
  }

  async function send() {
    if (sending || sent) return;
    // An address still in a field counts as entered.
    var invalid = ["to", "cc", "bcc"].filter(function (f) { return !fields[f].commit(); });
    if (invalid.length) {
      S.showStatus("Ret de e-mailadresser, der ikke er gyldige.", true);
      fields[invalid[0]].input.focus();
      return;
    }
    var to = fields.to.values();
    var cc = fields.cc.values();
    var bcc = fields.bcc.values();
    if (!to.length) {
      S.showStatus("Tilføj mindst én modtager i Til.", true);
      fields.to.input.focus();
      return;
    }
    if (!subject.value.trim()) {
      S.showStatus("Skriv et emne.", true);
      subject.focus();
      return;
    }
    var fileIds = isLink() ? null : checkedFileIds();
    if (fileIds && !fileIds.length) {
      S.showStatus("Vælg mindst én fil, der skal sendes.", true);
      return;
    }

    sending = true;
    sendButton.disabled = true;
    try {
      if (isLink()) {
        S.showStatus("Kontrollerer modtagernes adgang...");
        var without = await recipientsWithoutAccess(to.concat(cc, bcc));
        if (without.length) {
          var names = without.map(function (r) { return r.name && r.name !== r.email ? r.name + " (" + r.email + ")" : r.email; });
          var go = await confirmDialog("Send alligevel?",
            "Følgende modtagere kan ikke åbne linket: " + names.join(", ") + ".", "Send alligevel");
          if (!go) {
            S.showStatus("");
            return;
          }
        }
      }

      // Converting to PDF takes about 2 seconds per file.
      S.showStatus("Sender…");
      var body = {
        to: to.map(payload),
        cc: cc.map(payload),
        bcc: bcc.map(payload),
        subject: subject.value.trim(),
        bodyHtml: messageHtml(),
        saveAsDocument: $("save-as-document").checked
      };
      if (fileIds) body.fileIds = fileIds;
      var result = await Api.post(docPath(isLink() ? "/email/link" : "/email/pdf"), { json: body });

      sent = true;
      lockForm();
      var attached = result && result.attachments && result.attachments.length
        ? " Vedhæftet: " + result.attachments.join(", ") + "." : "";
      S.showStatus("Emailen er sendt." + attached + (body.saveAsDocument ? " Den er også gemt som dokument på sagen." : "") +
        " Du kan lukke vinduet.");
    } catch (error) {
      if (error.status === 412) {
        S.showStatus(NO_ACCOUNT, true);
      } else if (error.status === 400 || error.status === 422 || error.status === 502) {
        // The server's error text is meant to be shown as it is.
        S.showStatus(error.message, true);
      } else if (error.status === 404 && !isLink()) {
        S.showStatus("En af filerne blev ikke fundet, eller du har ikke adgang til dokumentet. (" + error.message + ")", true);
      } else {
        S.reportError(error);
      }
    } finally {
      sending = false;
      sendButton.disabled = sent;
    }
  }

  function lockForm() {
    form.querySelectorAll("input, button").forEach(function (el) { el.disabled = true; });
    message.contentEditable = "false";
    sendButton.textContent = "Sendt";
  }

  sendButton.addEventListener("click", send);
  form.addEventListener("submit", function (event) { event.preventDefault(); });

  // --- Start -----------------------------------------------------------------------------

  async function start() {
    form.hidden = true;
    sendButton.hidden = true;
    S.showStatus("Henter...");
    try {
      // Check the Mail app account first; without one there is nothing to show.
      var account = await Api.get("/email/account");
      if (!account || !account.configured) {
        $("content").appendChild(element("div", "notice problem", NO_ACCOUNT));
        S.showStatus("");
        return;
      }
      doc = await S.loadDocument(fileId);
      $("document-label").textContent = [doc.documentnumber, doc.title].filter(Boolean).join(" — ");

      var from = account.from || {};
      $("from").textContent = from.label && from.address ? from.label + " <" + from.address + ">" : (from.address || from.label || "");
      if (!subject.value) subject.value = doc.title || "";

      if (isLink()) {
        $("message-hint").textContent = "Et link til dokumentet (" +
          [doc.documentnumber, doc.title].filter(Boolean).join(" ") + ") tilføjes under beskeden. " +
          "Linket virker kun for OpenCase-brugere, der har adgang til dokumentet.";
      } else {
        $("files-field").hidden = false;
        renderFiles(await loadFiles());
      }

      form.hidden = false;
      sendButton.hidden = false;
      S.showStatus("");
      fields.to.input.focus();
    } catch (error) {
      if (error.status === 412) {
        $("content").appendChild(element("div", "notice problem", NO_ACCOUNT));
        S.showStatus("");
      } else {
        S.reportError(error);
      }
    }
  }

  document.querySelectorAll(".recipients").forEach(function (container) {
    fields[container.dataset.field] = createRecipientField(container, container.dataset.field);
  });
  buildToolbar();

  window.Asc.plugin.init = function () {
    window.Asc.plugin.sendToPlugin("onSendReady", null);
  };

  // From the main plugin: the open file and which email to send.
  window.Asc.plugin.attachEvent("onShowSend", function (data) {
    if (!data || !data.fileId) {
      S.showStatus("Den åbne fil kunne ikke findes i OpenCase. Er dokumentet åbnet fra OpenCase?", true);
      return;
    }
    fileId = data.fileId;
    variant = data.variant === "pdf" ? "pdf" : "link";
    var title = isLink() ? "Send link med email" : "Send PDF med email";
    $("heading").textContent = title;
    document.title = title;
    start();
  });

  window.Asc.plugin.attachEvent("onLoggedIn", start);

  window.Asc.plugin.attachEvent("onLoginFailed", function (data) {
    S.showLogin("Login fejlede: " + (data && data.error));
  });
})(window);
