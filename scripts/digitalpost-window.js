// "Send Digital post": sends the open file's document with Digital Post, as
// Digital post on the document page in OpenCase does. A document is sent
// once; after that the dialog shows the status of that shipment.
(function (window) {
  var Api = window.OpenCaseApi;
  var S = window.OpenCaseSend;
  var element = S.element;
  var button = S.button;
  var POLL_INTERVAL_MS = 10000; // as OpenCase

  var content = document.getElementById("content");
  var actions = document.getElementById("actions");

  var fileId = null;
  var doc = null;
  var pollTimer = null;
  var sending = false;

  function docPath(suffix) {
    return "/documents/" + encodeURIComponent(doc.id) + suffix;
  }

  function setActions(buttons) {
    actions.replaceChildren.apply(actions, buttons);
  }

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  async function start() {
    stopPolling();
    content.replaceChildren();
    setActions([]);
    S.showStatus("Henter...");
    try {
      doc = await S.loadDocument(fileId);
      await showState(await Api.get(docPath("/digital-post")));
    } catch (error) {
      S.reportError(error);
    }
  }

  // GET/POST /documents/{id}/digital-post: { enabled, canSend, inProgress, shipment }
  async function showState(state) {
    if (!state || state.enabled === false) {
      content.replaceChildren(element("div", "notice", "Digital Post er ikke tilgængelig på denne server."));
      S.showStatus("");
      return;
    }
    if (state.shipment) {
      renderShipment(state);
      return;
    }
    if (!state.canSend) {
      content.replaceChildren(element("div", "notice",
        "Du kan ikke sende dette dokument med Digital Post. Det kræver, at du kan ændre dokumentet, " +
        "eller at dokumentets status er endelig."));
      S.showStatus("");
      return;
    }
    await showDraft();
  }

  // --- 2. The send dialog -------------------------------------------------------

  async function showDraft() {
    S.showStatus("Henter...");
    var draft = await Api.get(docPath("/digital-post/draft"));
    content.replaceChildren();
    content.appendChild(element("h2", null, "Digital post"));
    content.appendChild(element("div", "muted", [doc.documentnumber, doc.title].filter(Boolean).join(" — ")));

    var replyLabel = element("label", "check");
    var reply = document.createElement("input");
    reply.type = "checkbox";
    reply.checked = !!draft.canBeReplied;
    replyLabel.appendChild(reply);
    replyLabel.appendChild(document.createTextNode("Kan besvares"));
    replyLabel.style.marginTop = "12px";
    content.appendChild(replyLabel);

    // Files: the main document (the letter) and the rest as additional documents.
    content.appendChild(element("h3", null, "Filer"));
    var files = draft.files || [];
    var filesTable = table(["Hoveddokument", "Fil"]);
    files.forEach(function (file) {
      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "main-file";
      radio.value = String(file.id);
      radio.checked = file.id === draft.mainFileId;
      radio.setAttribute("aria-label", "Brug " + file.name + " som hoveddokument");
      addRow(filesTable, [cell(radio, "fit"), cell(file.name)]);
    });
    if (!files.length) addRow(filesTable, [cell("Dokumentet har ingen filer.", null, 2)]);
    content.appendChild(filesTable.table);
    content.appendChild(element("div", "muted small",
      "Hoveddokumentet er selve brevet. De andre filer sendes med som yderligere dokumenter."));

    // Attachments (the document's Bilag): listed and sent along when ticked.
    var attachments = draft.attachments || [];
    var attachLabel = element("label", "check");
    var includeAttachments = document.createElement("input");
    includeAttachments.type = "checkbox";
    includeAttachments.checked = !!draft.includeAttachments;
    attachLabel.appendChild(includeAttachments);
    attachLabel.appendChild(document.createTextNode("Inkluder bilag" +
      (attachments.length ? " (" + attachments.length + ")" : " (dokumentet har ingen bilag)")));
    attachLabel.style.marginTop = "12px";
    includeAttachments.disabled = !attachments.length;
    content.appendChild(attachLabel);

    var attachTable = table(["Bilag", "Fil"]);
    attachments.forEach(function (attachment) {
      var label = [attachment.documentnumber, attachment.title].filter(Boolean).join(" — ");
      (attachment.files || []).forEach(function (file, index) {
        addRow(attachTable, [cell(index === 0 ? label : ""), cell(file.name)]);
      });
    });
    attachTable.table.hidden = !includeAttachments.checked || !attachments.length;
    includeAttachments.addEventListener("change", function () {
      attachTable.table.hidden = !includeAttachments.checked;
    });
    content.appendChild(attachTable.table);

    // Receivers: the document's contacts with the role Modtager.
    content.appendChild(element("h3", null, "Modtagere"));
    var receivers = draft.receivers || [];
    if (!receivers.length) {
      content.appendChild(element("div", "notice warning",
        "Dokumentet har ingen modtagere. Tilføj en kontakt med rollen Modtager under Dokument info → " +
        "Afsendere/modtagere, og åbn så Digital post igen."));
    } else {
      var receiverTable = table(["Navn", "CPR/CVR", "Adresse", "Digital Post"]);
      receivers.forEach(function (receiver) {
        var subscription = cell("…", "fit");
        addRow(receiverTable, [
          cell(receiver.name),
          cell(receiver.cprCvr ? S.maskCpr(receiver.cprCvr) : "—", "fit"),
          cell(receiver.addressProtected ? "Beskyttet adresse" : (receiver.address || "—")),
          subscription
        ]);
        if (receiver.cprCvr) {
          checkSubscription(receiver, subscription);
        } else {
          subscription.textContent = "—";
        }
      });
      content.appendChild(receiverTable.table);
    }

    var send = button("Send", "button primary", function () {
      var main = content.querySelector('input[name="main-file"]:checked');
      sendShipment(send, {
        mainFileId: main ? Number(main.value) : draft.mainFileId,
        canBeReplied: reply.checked,
        includeAttachments: includeAttachments.checked && attachments.length > 0
      });
    });
    send.disabled = !draft.canSend || !receivers.length || !files.length;
    setActions([send]);
    S.showStatus("");
  }

  // One call per receiver, not waiting on each other.
  function checkSubscription(receiver, target) {
    Api.get(docPath("/contacts/" + encodeURIComponent(receiver.contactId) + "/digital-post-subscription"))
      .then(function (result) {
        var has = result ? result.hasSubscription : null;
        target.textContent = has === true ? "✓ Tilmeldt" : has === false ? "✗ Ikke tilmeldt" : "? Kunne ikke tjekkes";
        target.className = "fit " + (has === true ? "kind-sent" : has === false ? "kind-failed" : "muted");
      }, function () {
        target.textContent = "? Kunne ikke tjekkes";
        target.className = "fit muted";
      });
  }

  // --- 3. Send ---------------------------------------------------------------------

  async function sendShipment(send, body) {
    if (sending) return;
    sending = true;
    send.disabled = true;
    S.showStatus("Sender…");
    try {
      var state = await Api.post(docPath("/digital-post"), { json: body });
      S.showStatus("Dokumentet er sendt til Digital Post. Du får en notifikation i OpenCase, når forsendelsen er færdig.");
      renderShipment(state, true);
    } catch (error) {
      send.disabled = false;
      if (error.status === 409) {
        S.showStatus("Dokumentet er allerede sendt med Digital Post.", true);
        start();
      } else if (error.status === 501) {
        S.showStatus("Digital Post er ikke tilgængelig på denne server.", true);
      } else {
        S.reportError(error);
      }
    } finally {
      sending = false;
    }
  }

  // --- 4. Status ---------------------------------------------------------------------

  function statusLabel(s) {
    return element("span", "status-label kind-" + ((s && s.kind) || "progress"), (s && (s.label || s.code)) || "Ukendt");
  }

  function downloadButton(path, name) {
    var b = button("Download", "button small", async function () {
      b.disabled = true;
      try {
        await S.download(path, name);
      } catch (error) {
        S.reportError(error);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }

  function pdfName(name) {
    return String(name || "dokument").replace(/\.[^.]+$/, "") + ".pdf";
  }

  function renderShipment(state, keepStatus) {
    var shipment = state.shipment;
    content.replaceChildren();
    content.appendChild(element("h2", null, "Digital post – status"));
    content.appendChild(element("div", "muted", [doc.documentnumber, doc.title].filter(Boolean).join(" — ")));

    var summary = table(null);
    addRow(summary, [cell("Status", "fit muted"), cell(statusLabel(shipment.status))]);
    var created = [S.formatDateTime(shipment.createdAt),
      shipment.createdBy && shipment.createdBy.displayName ? "af " + shipment.createdBy.displayName : ""].filter(Boolean).join(" ");
    addRow(summary, [cell("Oprettet", "fit muted"), cell(created || "—")]);
    var main = (shipment.files || []).find(function (f) { return f.isMain; });
    if (main) {
      addRow(summary, [cell("Hoveddokument", "fit muted"), cell(main.name)]);
    }
    addRow(summary, [cell("Kan besvares", "fit muted"), cell(shipment.canBeReplied ? "Ja" : "Nej")]);
    summary.table.style.marginTop = "10px";
    content.appendChild(summary.table);

    content.appendChild(element("h3", null, "Yderligere dokumenter"));
    var others = (shipment.files || []).filter(function (f) { return !f.isMain; });
    var filesTable = table(["Fil", ""]);
    others.forEach(function (file) {
      addRow(filesTable, [cell(file.name),
        cell(file.hasPdf ? downloadButton("/digital-post/files/" + encodeURIComponent(file.id) + "/pdf", pdfName(file.name)) : "", "fit")]);
    });
    if (!others.length) addRow(filesTable, [cell("Ingen", "muted", 2)]);
    content.appendChild(filesTable.table);

    content.appendChild(element("h3", null, "Modtagere"));
    var receiverTable = table(["Navn", "CPR/CVR", "Status", ""]);
    (shipment.receivers || []).forEach(function (receiver) {
      addRow(receiverTable, [
        cell(receiver.name),
        cell(receiver.cprCvr ? S.maskCpr(receiver.cprCvr) : "—", "fit"),
        cell(statusLabel(receiver.status), "fit"),
        cell(receiver.hasPdf
          ? downloadButton("/digital-post/receivers/" + encodeURIComponent(receiver.id) + "/pdf", pdfName(receiver.name))
          : "", "fit")
      ]);
    });
    if (!(shipment.receivers || []).length) addRow(receiverTable, [cell("Ingen", "muted", 4)]);
    content.appendChild(receiverTable.table);

    setActions([button("Opdater", "button", refresh)]);
    if (!keepStatus) {
      S.showStatus(state.inProgress ? "Forsendelsen er i gang. Status opdateres hvert 10. sekund." : "");
    }

    // While it is being sent, follow it as OpenCase does.
    stopPolling();
    if (state.inProgress) pollTimer = setTimeout(refresh, POLL_INTERVAL_MS);
  }

  async function refresh() {
    stopPolling();
    try {
      var state = await Api.get(docPath("/digital-post"));
      if (state && state.shipment) {
        renderShipment(state);
      } else {
        await showState(state);
      }
    } catch (error) {
      S.reportError(error);
      // Keep following a running shipment after a passing error.
      pollTimer = setTimeout(refresh, POLL_INTERVAL_MS);
    }
  }

  // --- Tables ------------------------------------------------------------------------

  function table(headings) {
    var t = element("table");
    if (headings) {
      var head = element("tr");
      headings.forEach(function (h) { head.appendChild(element("th", null, h)); });
      var thead = element("thead");
      thead.appendChild(head);
      t.appendChild(thead);
    }
    var body = element("tbody");
    t.appendChild(body);
    return { table: t, body: body };
  }

  function cell(value, className, span) {
    var td = element("td", className || null);
    if (value instanceof Node) td.appendChild(value);
    else td.textContent = value;
    if (span) td.colSpan = span;
    return td;
  }

  function addRow(t, cells) {
    var tr = element("tr");
    cells.forEach(function (c) { tr.appendChild(c); });
    t.body.appendChild(tr);
  }

  // --- Start --------------------------------------------------------------------------

  window.Asc.plugin.init = function () {
    window.Asc.plugin.sendToPlugin("onSendReady", null);
  };

  // From the main plugin: the open file.
  window.Asc.plugin.attachEvent("onShowSend", function (data) {
    if (!data || !data.fileId) {
      S.showStatus("Den åbne fil kunne ikke findes i OpenCase. Er dokumentet åbnet fra OpenCase?", true);
      return;
    }
    fileId = data.fileId;
    start();
  });

  window.Asc.plugin.attachEvent("onLoggedIn", start);

  window.Asc.plugin.attachEvent("onLoginFailed", function (data) {
    S.showLogin("Login fejlede: " + (data && data.error));
  });
})(window);
