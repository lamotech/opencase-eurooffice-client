// Search dialog: GET /documents/fulltextsearch with facets, filter chips and paging.
(function (window) {
  var FACET_GROUPS = [
    { key: "organisations", param: "organisation", title: "Organisation" },
    { key: "caseTypes", param: "case_type", title: "Sagstype" },
    { key: "documentTypes", param: "document_type", title: "Dokumenttype" }
  ];
  var FILTER_TITLES = {
    organisation: "Organisation",
    case_type: "Sagstype",
    document_type: "Dokumenttype",
    year: "År"
  };

  var form = document.getElementById("search-form");
  var input = document.getElementById("query");
  var searchButton = document.getElementById("search-button");
  var chips = document.getElementById("chips");
  var facets = document.getElementById("facets");
  var results = document.getElementById("results");
  var status = document.getElementById("status");
  var prev = document.getElementById("prev");
  var next = document.getElementById("next");

  var state = {
    query: "",
    filters: {},
    // Facet labels by filter param, for the chips (the server echoes values only).
    labels: {},
    offset: 0,
    limit: null,
    total: 0
  };
  // Ignores responses from a search that was replaced while loading.
  var searchId = 0;

  function showStatus(message) {
    status.textContent = message;
  }

  async function search() {
    if (!state.query) return;

    var id = ++searchId;
    searchButton.disabled = true;
    showStatus("Søger...");

    var params = Object.assign({ q: state.query, offset: state.offset }, state.filters);
    if (state.limit) params.limit = state.limit;

    try {
      var data = await window.OpenCaseApi.get("/documents/fulltextsearch", params);
      if (id !== searchId) return;
      render(data);
    } catch (error) {
      if (id !== searchId) return;
      clearResults();
      if (error instanceof window.OpenCaseApi.NotLoggedInError) {
        showLogin(error.message);
      } else {
        showStatus("FEJL: " + error.message);
      }
    } finally {
      if (id === searchId) searchButton.disabled = false;
    }
  }

  function clearResults() {
    results.replaceChildren();
    facets.replaceChildren();
    chips.replaceChildren();
    prev.disabled = true;
    next.disabled = true;
  }

  function render(data) {
    var files = data.files || [];
    state.total = data.total || 0;
    state.limit = data.limit || state.limit;
    state.offset = data.offset || 0;
    state.filters = Object.assign({}, data.filters || {});

    renderChips();
    renderFacets(data.facets || {});

    results.replaceChildren();
    results.scrollTop = 0;
    if (!files.length) {
      results.appendChild(element("div", "empty", "Ingen filer fundet"));
    }
    files.forEach(function (file) {
      results.appendChild(renderFile(file));
    });

    var first = state.total ? state.offset + 1 : 0;
    var last = state.offset + files.length;
    showStatus(state.total
      ? "Viser " + first + "–" + last + " af " + state.total + " filer"
      : "Ingen filer fundet for \"" + state.query + "\"");

    prev.disabled = state.offset <= 0;
    next.disabled = !state.limit || state.offset + state.limit >= state.total;
  }

  function renderChips() {
    chips.replaceChildren();
    Object.keys(state.filters).forEach(function (param) {
      var value = state.filters[param];
      if (value === undefined || value === null || value === "") return;
      var label = state.labels[param] || value;

      var chip = element("button", "chip");
      chip.type = "button";
      chip.title = "Fjern filter";
      chip.setAttribute("aria-label", "Fjern filter " + (FILTER_TITLES[param] || param) + ": " + label);
      chip.appendChild(document.createTextNode((FILTER_TITLES[param] || param) + ": " + label));
      chip.appendChild(element("span", null, "×"));
      chip.addEventListener("click", function () {
        setFilter(param, null);
      });
      chips.appendChild(chip);
    });
  }

  function renderFacets(data) {
    facets.replaceChildren();
    FACET_GROUPS.forEach(function (group) {
      var items = data[group.key] || [];
      if (!items.length) return;

      var section = element("div", "facet-group");
      section.appendChild(element("h4", null, group.title));
      var list = document.createElement("ul");

      items.forEach(function (item) {
        var active = String(state.filters[group.param]) === String(item.value);
        var button = element("button", "facet" + (active ? " active" : ""));
        button.type = "button";
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.appendChild(element("span", null, item.label));
        button.appendChild(element("span", "count", String(item.count)));
        // Clicking the active item again removes the filter.
        button.addEventListener("click", function () {
          if (active) {
            setFilter(group.param, null);
          } else {
            state.labels[group.param] = item.label;
            setFilter(group.param, item.value);
          }
        });

        var li = document.createElement("li");
        li.appendChild(button);
        list.appendChild(li);
      });

      section.appendChild(list);
      facets.appendChild(section);
    });
  }

  function setFilter(param, value) {
    if (value === null) {
      delete state.filters[param];
      delete state.labels[param];
    } else {
      state.filters[param] = value;
    }
    state.offset = 0;
    search();
  }

  function renderFile(file) {
    var doc = file.document || {};
    var caseInfo = file.case || {};
    var item = element("div", "result");

    var heading = element("div", "result-heading");
    heading.appendChild(fileIcon());

    var name = element("button", "file-name", file.name);
    name.type = "button";
    name.title = file.editorUrl ? "Åbn " + file.name : "Vis dokumentet i OpenCase";
    name.addEventListener("click", function () {
      if (file.editorUrl) {
        openFile(file);
      } else if (doc.url) {
        openUrl(doc.url);
      }
    });
    heading.appendChild(name);
    heading.appendChild(element("span", "badge", "Fil"));

    if (caseInfo.caseNumber || caseInfo.title) {
      heading.appendChild(element("span", "case",
        [caseInfo.caseNumber, caseInfo.title].filter(Boolean).join(" — ")));
    }
    if (doc.url) {
      heading.appendChild(openUrlButton(doc));
    }
    item.appendChild(heading);

    if (file.highlights && file.highlights.length) {
      var snippet = element("div", "snippet");
      snippet.appendChild(highlightFragment(file.highlights.join(" … ")));
      item.appendChild(snippet);
    }

    var meta = [caseInfo.organisation, caseInfo.year, doc.documentType].filter(Boolean);
    if (meta.length) {
      item.appendChild(element("div", "meta", meta.join(" · ")));
    }
    return item;
  }

  // The server escapes highlights and only adds <mark>. Rebuild the DOM keeping
  // nothing but text and <mark>, so other markup can never be injected.
  function highlightFragment(html) {
    var template = document.createElement("template");
    template.innerHTML = html;
    var fragment = document.createDocumentFragment();
    template.content.childNodes.forEach(function (node) {
      if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === "MARK") {
        fragment.appendChild(element("mark", null, node.textContent));
      } else {
        fragment.appendChild(document.createTextNode(node.textContent));
      }
    });
    return fragment;
  }

  function fileIcon() {
    var span = element("span", "file-icon");
    span.setAttribute("aria-hidden", "true");
    span.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">' +
      '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/></svg>';
    return span;
  }

  function openUrlButton(doc) {
    var button = element("button", "open-url");
    button.type = "button";
    button.title = "Vis dokumentet i OpenCase";
    button.setAttribute("aria-label", "Vis " + (doc.title || "dokumentet") + " i OpenCase");
    button.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5"/>' +
      '<path d="M12 9.5V13a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 3 13V5a.5.5 0 0 1 .5-.5H7"/></svg>';
    button.addEventListener("click", function () {
      openUrl(doc.url);
    });
    return button;
  }

  function openFile(file) {
    showStatus("Åbner " + file.name + "...");
    window.Asc.plugin.sendToPlugin("onOpenDocument", {
      fileId: file.fileId,
      name: file.name,
      editorUrl: file.editorUrl
    });
  }

  function openUrl(url) {
    showStatus("Åbner " + url + " i browseren...");
    window.Asc.plugin.sendToPlugin("onOpenUrl", { url: url });
  }

  function showLogin(message) {
    showStatus(message + " (" + window.OpenCaseSettings.getUrl() + ")");
    var button = element("button", "primary login", "Log ind");
    button.type = "button";
    button.addEventListener("click", function () {
      button.disabled = true;
      showStatus("Log ind i browseren, og giv adgang. Venter...");
      window.Asc.plugin.sendToPlugin("onLogin", null);
    });
    results.replaceChildren(button);
  }

  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var query = input.value.trim();
    if (!query) {
      showStatus("Skriv en søgetekst.");
      input.focus();
      return;
    }
    // A new search text starts over: filters from the old results may not apply.
    if (query !== state.query) {
      state.filters = {};
      state.labels = {};
    }
    state.query = query;
    state.offset = 0;
    search();
  });

  prev.addEventListener("click", function () {
    state.offset = Math.max(0, state.offset - (state.limit || 0));
    search();
  });

  next.addEventListener("click", function () {
    state.offset += state.limit || 0;
    search();
  });

  window.Asc.plugin.init = function () {
    input.focus();
  };

  window.Asc.plugin.attachEvent("onLoggedIn", function () {
    if (state.query) {
      search();
    } else {
      results.replaceChildren();
      showStatus("Du er logget ind. Skriv en søgetekst, og tryk Søg.");
    }
  });

  window.Asc.plugin.attachEvent("onLoginFailed", function (data) {
    showLogin("Login fejlede: " + (data && data.error));
  });

  // Result of onOpenDocument from the main plugin.
  window.Asc.plugin.attachEvent("onDesktopApiTest", function (data) {
    if (data && data.commandExecuted === false) {
      showStatus("FEJL: " + data.error);
    }
  });
})(window);
