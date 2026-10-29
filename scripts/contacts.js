// Senders and recipients (Afsendere/Modtagere): the list, "Tilføj borger" /
// "Tilføj virksomhed" (register search, or entered by hand) and deleting.
// Shared by Dokument info, which changes the document straight away, and
// Gem i OpenCase, which collects them until the document is created. The
// difference is the store passed to create().
// Requires scripts/api.js and scripts/panel.js.
(function (window) {
  var Api = window.OpenCaseApi;
  var P = window.OpenCasePanel;
  var element = P.element;
  var button = P.button;
  var field = P.field;
  var input = P.input;

  var roles = null; // GET /contact-roles
  var me = null;    // GET /me, for registerSearch

  async function ensureLists() {
    var pending = [];
    if (!roles) pending.push(Api.get("/contact-roles").then(function (data) { roles = data || []; }));
    if (!me) pending.push(Api.get("/me").then(function (data) { me = data || {}; }));
    await Promise.all(pending);
  }

  function roleById(id) {
    return (roles || []).find(function (r) { return String(r.id) === String(id); }) || null;
  }

  // As OpenCase: the first six digits, then XXXX.
  function maskCpr(cpr) {
    var digits = String(cpr || "").replace(/\D/g, "");
    return digits.length >= 6 ? digits.slice(0, 6) + "XXXX" : cpr;
  }

  function formatAddress(a) {
    if (!a) return "";
    if (a.formatted) return a.formatted;
    var street = [a.streetname, a.housenumber].filter(Boolean).join(" ");
    var unit = [a.floor, a.door].filter(Boolean).join(". ");
    var town = [a.zipcode, a.zipdistrict].filter(Boolean).join(" ");
    return [[street, unit].filter(Boolean).join(", "), town].filter(Boolean).join(", ");
  }

  function roleSelect(selected) {
    var select = document.createElement("select");
    select.add(new Option("Vælg rolle...", ""));
    roles.forEach(function (r) { select.add(new Option(r.name, String(r.id))); });
    select.value = selected || "";
    return select;
  }

  // options:
  //   box:          element that holds the list
  //   store:        { add(body, preview) → contact, remove(contact),
  //                   revealAddress(contact) → address (optional) }
  //   canChange():  whether contacts can be added and deleted now
  //   onChange():   called after the list changed (e.g. to update a count)
  //   showStatus(message, problem), onNotLoggedIn(message), errorText(error)
  function create(options) {
    var contacts = [];
    var errorText = options.errorText || function (error) { return error.message; };

    function changed() {
      render();
      if (options.onChange) options.onChange();
    }

    function contactNumbers(contact) {
      var line = element("div", "sub");
      if (contact.type === "citizen" && contact.cprCvr) {
        line.appendChild(document.createTextNode("CPR "));
        // Masked as in OpenCase; shown in full only when clicked.
        var cpr = button(maskCpr(contact.cprCvr), "link", function () {
          cpr.textContent = cpr.textContent === contact.cprCvr ? maskCpr(contact.cprCvr) : contact.cprCvr;
        });
        cpr.title = "Vis/skjul hele CPR-nummeret";
        line.appendChild(cpr);
      } else if (contact.cprCvr) {
        line.appendChild(document.createTextNode("CVR " + contact.cprCvr));
      }
      if (contact.pnumber) line.appendChild(document.createTextNode(" · P-nr. " + contact.pnumber));
      return line.childNodes.length ? line : null;
    }

    function addressLine(contact) {
      var line = element("div", "sub");
      if (contact.addressProtected) {
        if (!options.store.revealAddress) {
          line.textContent = "Beskyttet adresse";
          return line;
        }
        // Only fetched when clicked: each lookup is logged. Not cached.
        var reveal = button("Beskyttet adresse", "link", async function () {
          reveal.disabled = true;
          try {
            var address = await options.store.revealAddress(contact);
            line.replaceChildren(document.createTextNode(
              "Beskyttet adresse: " + (formatAddress(address) || "ingen adresse")));
          } catch (error) {
            reveal.disabled = false;
            report(error);
          }
        });
        reveal.title = "Vis den beskyttede adresse. Opslaget logges.";
        line.appendChild(reveal);
      } else if (contact.address) {
        line.textContent = formatAddress(contact.address);
      }
      return line.childNodes.length ? line : null;
    }

    function report(error) {
      if (error instanceof Api.NotLoggedInError) {
        options.onNotLoggedIn(error.message);
      } else {
        options.showStatus("FEJL: " + errorText(error), true);
      }
    }

    function render() {
      var box = options.box;
      box.replaceChildren();
      if (!contacts.length) {
        box.appendChild(element("div", "none", options.emptyText || "Ingen afsendere eller modtagere"));
        return;
      }
      var list = element("ul", "items");
      contacts.forEach(function (contact) {
        var li = element("li", "item");
        var body = element("div", "body");
        var name = element("div", "name", contact.name);
        if (contact.role) name.appendChild(element("span", "badge role", contact.role.name));
        body.appendChild(name);
        [contactNumbers(contact), addressLine(contact)].forEach(function (line) {
          if (line) body.appendChild(line);
        });
        var reach = [contact.phone, contact.email].filter(Boolean).join(" · ");
        if (reach) body.appendChild(element("div", "sub", reach));
        li.appendChild(body);

        if (options.canChange()) {
          var tools = element("div", "tools");
          tools.appendChild(button("Slet", "button small danger", function () { remove(contact); }));
          li.appendChild(tools);
        }
        list.appendChild(li);
      });
      box.appendChild(list);
    }

    async function remove(contact) {
      var ok = await P.confirmDialog("Slet kontakt", "Er du sikker på, at du vil slette denne kontakt?", "Slet");
      if (!ok) return;
      try {
        await options.store.remove(contact);
        contacts = contacts.filter(function (c) { return c !== contact; });
        changed();
        options.showStatus(contact.name + " er slettet.");
      } catch (error) {
        report(error);
      }
    }

    function duplicateText(isCitizen) {
      return "Denne " + (isCitizen ? "borger" : "virksomhed") + " er allerede tilføjet med den valgte rolle";
    }

    // "Tilføj borger" / "Tilføj virksomhed": role, search, add; or enter by hand.
    async function openAdd(kind) {
      try {
        await ensureLists();
      } catch (error) {
        report(error);
        return;
      }
      var isCitizen = kind === "citizen";

      P.openDialog(isCitizen ? "Tilføj borger" : "Tilføj virksomhed", function (box, close) {
        var role = roleSelect();
        field(box, "Rolle *", role);

        if (me.registerSearch === false) {
          box.appendChild(element("div", "hint", "Søger kun i " + (isCitizen ? "borgere" : "virksomheder") +
            ", der allerede er på sager."));
        }

        var form = element("div");
        var search = {};
        var grid;
        var pBox = null;
        if (isCitizen) {
          search.cpr = field(form, "CPR-nummer", input(), "Eller søg på navn og adresse:");
          grid = element("div", "grid");
          [["firstname", "Fornavn"], ["lastname", "Efternavn"], ["streetname", "Vejnavn"],
            ["housenumber", "Husnummer"], ["zipcode", "Postnummer"], ["zipdistrict", "By"]].forEach(function (f) {
            search[f[0]] = field(grid, f[1], input());
          });
          form.appendChild(grid);
        } else {
          grid = element("div", "grid");
          search.cvr = field(grid, "CVR-nummer", input());
          search.name = field(grid, "Navn", input());
          form.appendChild(grid);
          var pLabel = element("label", "inline");
          pBox = input("checkbox");
          pLabel.appendChild(pBox);
          pLabel.appendChild(document.createTextNode("Vis virksomhedens produktionsenheder (P-numre)"));
          form.appendChild(pLabel);
        }
        box.appendChild(form);

        var error = element("div", "error");
        var results = element("ul", "results");
        results.hidden = true;
        box.appendChild(error);
        box.appendChild(results);

        var buttons = element("div", "buttons");
        var searchButton = button("Søg", "button primary", runSearch);
        buttons.appendChild(button("Opret manuelt", "button", function () {
          close();
          openManual(kind, role.value);
        }));
        buttons.appendChild(button("Annuller", "button", close));
        buttons.appendChild(searchButton);
        box.appendChild(buttons);

        form.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            runSearch();
          }
        });

        function params() {
          var result = {};
          Object.keys(search).forEach(function (key) {
            var value = search[key].value.trim();
            if (value) result[key] = value;
          });
          // CPR alone, or the name and address fields.
          if (isCitizen && result.cpr) return { cpr: result.cpr };
          if (!isCitizen && result.cvr) {
            return pBox.checked ? { cvr: result.cvr, pnumbers: 1 } : { cvr: result.cvr };
          }
          return result;
        }

        async function runSearch() {
          error.textContent = "";
          if (!role.value) {
            error.textContent = "Vælg en rolle.";
            role.focus();
            return;
          }
          var query = params();
          if (!Object.keys(query).length) {
            error.textContent = "Udfyld mindst ét søgefelt.";
            return;
          }
          searchButton.disabled = true;
          results.hidden = false;
          results.replaceChildren(element("li", "none", "Søger..."));
          try {
            var data = await Api.get(isCitizen ? "/citizens/search" : "/companies/search", query);
            var found = (data && data.results) || [];
            if (found.length === 1) {
              // As OpenCase: a single hit is added straight away.
              results.replaceChildren(element("li", "none", "Tilføjer " + found[0].name + "..."));
              await addHit(found[0]);
              return;
            }
            renderResults(found, data && data.source);
          } catch (err) {
            results.hidden = true;
            if (err instanceof Api.NotLoggedInError) {
              close();
              options.onNotLoggedIn(err.message);
            } else {
              error.textContent = err.status === 400 ? "Udfyld mindst ét søgefelt." : err.message;
            }
          } finally {
            searchButton.disabled = false;
          }
        }

        function renderResults(found, source) {
          results.replaceChildren();
          if (!found.length) {
            results.appendChild(element("li", "none", "Ingen " + (isCitizen ? "borgere" : "virksomheder") +
              " fundet" + (source === "local" ? " på sager" : "") + ". Du kan oprette kontakten manuelt."));
            return;
          }
          found.forEach(function (hit) {
            var li = element("li", "item");
            var body = element("div", "body");
            body.appendChild(element("div", "name", hit.name));
            var numbers = isCitizen
              ? (hit.cprCvr ? "CPR " + maskCpr(hit.cprCvr) : "")
              : [hit.cprCvr ? "CVR " + hit.cprCvr : "", hit.pnumber ? "P-nr. " + hit.pnumber : ""].filter(Boolean).join(" · ");
            if (numbers) body.appendChild(element("div", "sub", numbers));
            body.appendChild(element("div", "sub", hit.addressProtected
              ? "Beskyttet adresse" : formatAddress(hit.address)));
            li.appendChild(body);
            li.appendChild(button("Tilføj", "button small", function () { addHit(hit); }));
            results.appendChild(li);
          });
        }

        // The server looks the number up again and stores what it finds.
        async function addHit(hit) {
          var body = { roleId: Number(role.value), cprCvr: hit.cprCvr };
          if (hit.pnumber) body.pnumber = hit.pnumber;
          var preview = Object.assign({ type: kind }, hit, { role: roleById(role.value) });
          try {
            var contact = await options.store.add(body, preview);
            contacts.push(contact);
            changed();
            close();
            options.showStatus(contact.name + " er tilføjet som " +
              (contact.role ? contact.role.name.toLowerCase() : "kontakt") + ".");
          } catch (err) {
            results.hidden = true;
            if (err.status === 409 && err.duplicate !== false) {
              error.textContent = duplicateText(isCitizen);
            } else if (err.status === 404) {
              error.textContent = (isCitizen ? "Borgeren" : "Virksomheden") + " blev ikke fundet.";
            } else {
              error.textContent = errorText(err);
            }
          }
        }
      });
    }

    // A contact the registers don't know: entered by hand.
    function openManual(kind, roleId) {
      var isCitizen = kind === "citizen";
      P.openDialog(isCitizen ? "Opret borger manuelt" : "Opret virksomhed manuelt", function (box, close) {
        var role = roleSelect(roleId);
        field(box, "Rolle *", role);

        var values = {};
        values.name = field(box, "Navn *", input());
        var grid = element("div", "grid");
        values.cprCvr = field(grid, isCitizen ? "CPR-nummer" : "CVR-nummer", input());
        if (!isCitizen) values.pnumber = field(grid, "P-nummer", input());
        [["streetname", "Vejnavn"], ["housenumber", "Husnummer"], ["floor", "Etage"], ["door", "Dør"],
          ["zipcode", "Postnummer"], ["zipdistrict", "By"]].forEach(function (f) {
          values[f[0]] = field(grid, f[1], input());
        });
        values.phone = field(grid, "Telefon", input("tel"));
        values.email = field(grid, "E-mail", input("email"));
        box.appendChild(grid);

        var protectedLabel = element("label", "inline");
        var protectedBox = input("checkbox");
        protectedLabel.appendChild(protectedBox);
        protectedLabel.appendChild(document.createTextNode("Beskyttet adresse"));
        box.appendChild(protectedLabel);

        var error = element("div", "error");
        box.appendChild(error);

        var buttons = element("div", "buttons");
        var save = button("Tilføj", "button primary", async function () {
          error.textContent = "";
          if (!role.value) {
            error.textContent = "Vælg en rolle.";
            return;
          }
          var body = { roleId: Number(role.value), addressProtected: protectedBox.checked };
          Object.keys(values).forEach(function (key) {
            var value = values[key].value.trim();
            if (value) body[key] = value;
          });
          if (!body.name) {
            error.textContent = "Skriv et navn.";
            values.name.focus();
            return;
          }
          var preview = {
            type: kind,
            name: body.name,
            cprCvr: body.cprCvr || "",
            pnumber: body.pnumber || "",
            phone: body.phone || "",
            email: body.email || "",
            addressProtected: body.addressProtected,
            address: body.addressProtected ? null : body,
            role: roleById(role.value)
          };
          save.disabled = true;
          try {
            var contact = await options.store.add(body, preview);
            contacts.push(contact);
            changed();
            close();
            options.showStatus(contact.name + " er tilføjet.");
          } catch (err) {
            save.disabled = false;
            error.textContent = err.status === 409 && err.duplicate !== false
              ? duplicateText(isCitizen) : errorText(err);
          }
        });
        buttons.appendChild(button("Annuller", "button", close));
        buttons.appendChild(save);
        box.appendChild(buttons);
      });
    }

    return {
      set: function (list) {
        contacts = (list || []).slice();
        changed();
      },
      list: function () { return contacts.slice(); },
      count: function () { return contacts.length; },
      render: render,
      openAdd: openAdd,
      // "Tilføj borger" and "Tilføj virksomhed", for the section heading.
      addButtons: function () {
        return [
          button("Tilføj borger", "button small", function () { openAdd("citizen"); }),
          button("Tilføj virksomhed", "button small", function () { openAdd("company"); })
        ];
      }
    };
  }

  window.OpenCaseContacts = {
    create: create,
    maskCpr: maskCpr,
    formatAddress: formatAddress
  };
})(window);
