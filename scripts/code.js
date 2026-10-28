(function (window) {
  var TAB_ID = "opencase_tab";
  var OPEN_BUTTON_ID = "opencase_open";
  var SETTINGS_BUTTON_ID = "opencase_settings";

  var settingsWindow = null;

  var FAVORITES_BUTTON_ID = "opencase_favorites";
  var RECENT_BUTTON_ID = "opencase_recent";
  var MY_DOCUMENTS_BUTTON_ID = "opencase_my_documents";

  var documentsWindow = null;
  var documentsType = "recent";

  var SEARCH_BUTTON_ID = "opencase_search";
  var searchWindow = null;

  var SEND_DIGITAL_POST_BUTTON_ID = "opencase_send_digital_post";
  var SEND_LINK_BUTTON_ID = "opencase_send_link";
  var SEND_PDF_BUTTON_ID = "opencase_send_pdf";
  var sendWindow = null;
  var digitalPostEnabled = null; // null until checked

  var FROM_TEMPLATE_BUTTON_ID = "opencase_from_template";
  var fromTemplateWindow = null;

  var SAVE_BUTTON_ID = "opencase_save";
  var saveWindow = null;

  var DOCINFO_BUTTON_ID = "opencase_docinfo";
  var docInfoWindow = null;

  var TEMPLATES_BUTTON_ID = "opencase_templates";
  var templatesWindow = null;

  var NEW_TEMPLATE_BUTTON_ID = "opencase_new_template";
  var newTemplateWindow = null;
  var canManageTemplates = false; // from GET /me

  // Dropdown with the merge fields from GET /templates/fields. Its menu items
  // are "<id>_oo_sep_<value>": plugins.js calls the handler attached to <id>
  // with <value>, so one handler serves every item.
  var MERGE_FIELDS_BUTTON_ID = "opencase_merge_fields";
  var MERGE_FIELD_ITEM_ID = "opencase_merge_field";
  var mergeFields = null;       // the API response, once loaded
  var mergeFieldList = [];      // field per menu value (an index)
  var mergeFieldsState = "idle"; // idle | loading | error

  var LOGIN_BUTTON_ID = "opencase_login";
  var loginInProgress = null;

  function getToolbarItems() {
    return {
      guid: window.Asc.plugin.info.guid,
      tabs: [
        {
          id: TAB_ID,
          text: "OpenCase",
          // Groups: OpenCase · this document · document lists · templates.
          // Buttons that appear later (after login) are added at the end of the
          // ribbon by the editor, which is why the templates group is last.
          items: [
            {
              id: SETTINGS_BUTTON_ID,
              type: "big-button",
              text: "Indstillinger",
              hint: "Indstil adressen på OpenCase",
              icons: "resources/icons/settings.svg",
              lockInViewMode: false,
              enableToggle: false,
              separator: false
            },
            getLoginButton(),
            {
              id: OPEN_BUTTON_ID,
              type: "big-button",
              text: "Åbn OpenCase",
              hint: "Åbn OpenCase i browseren",
              icons: "resources/icons/icon.svg",
              lockInViewMode: false,
              enableToggle: false,
              separator: false
            },
            {
              id: FROM_TEMPLATE_BUTTON_ID,
              type: "big-button",
              text: "Ny fil fra skabelon",
              hint: "Opret en fil på et dokument i OpenCase ud fra en skabelon",
              icons: "resources/icons/from-template.svg",
              lockInViewMode: false,
              enableToggle: false,
              separator: true
            },
            // Only a local file can be saved to OpenCase; a document opened
            // from OpenCase (Document Server) is already there and shows its
            // metadata instead.
            isLocalDesktopFile() ? {
              id: SAVE_BUTTON_ID,
              type: "big-button",
              text: "Gem i OpenCase",
              hint: "Gem dokumentet som et nyt dokument på en sag i OpenCase",
              icons: "resources/icons/save.svg",
              lockInViewMode: true,
              enableToggle: false,
              separator: false
            } : {
              id: DOCINFO_BUTTON_ID,
              type: "big-button",
              text: "Dokument info",
              hint: "Vis oplysninger om dokumentet i OpenCase",
              icons: "resources/icons/docinfo.svg",
              lockInViewMode: false,
              enableToggle: false,
              separator: false
            },
            {
              id: MY_DOCUMENTS_BUTTON_ID,
              type: "big-button",
              text: "Mine dokumenter",
              hint: "Vis dine dokumenter",
              icons: "resources/icons/my-documents.svg",
              lockInViewMode: false,
              enableToggle: false,
              separator: true
            },
            {
              id: RECENT_BUTTON_ID,
              type: "big-button",
              text: "Seneste dokumenter",
              hint: "Vis de senest anvendte dokumenter",
              icons: "resources/icons/recent.svg",
              lockInViewMode: false,
              enableToggle: false,
              separator: false
            },
            {
              id: FAVORITES_BUTTON_ID,
              type: "big-button",
              text: "Favorit dokumenter",
              hint: "Vis dine favoritdokumenter",
              icons: "resources/icons/favorites.svg",
              lockInViewMode: false,
              enableToggle: false,
              separator: false
            },
            {
              id: SEARCH_BUTTON_ID,
              type: "big-button",
              text: "Søg dokument",
              hint: "Søg i filer og metadata i OpenCase",
              icons: "resources/icons/search.svg",
              lockInViewMode: false,
              enableToggle: false,
              separator: false
            }
          ].concat(isLocalDesktopFile() ? [] : getSendButtons()).concat(canManageTemplates ? [
            {
              id: NEW_TEMPLATE_BUTTON_ID,
              type: "big-button",
              text: "Ny skabelon",
              hint: "Opret en ny dokumentskabelon i OpenCase",
              icons: "resources/icons/new-template.svg",
              lockInViewMode: false,
              enableToggle: false,
              separator: true
            },
            {
              id: TEMPLATES_BUTTON_ID,
              type: "big-button",
              text: "Åbn skabelon",
              hint: "Åbn en dokumentskabelon fra OpenCase til redigering",
              icons: "resources/icons/template.svg",
              lockInViewMode: false,
              enableToggle: false,
              separator: false
            }
          ].concat(supportsMergeFields() ? [getMergeFieldsButton()] : []) : [])
        }
      ]
    };
  }

  // The plugin runs in the desktop app's own editor (local files) or in the
  // Document Server's editor (documents opened from OpenCase, in the desktop
  // app or a browser). AscDesktopEditor only exists in the desktop app; its
  // file functions answer for the frame they are called from, so ask the
  // editor's frame (the parent) when it can be reached.
  function desktopEditor() {
      try {
          if (window.parent && window.parent !== window && window.parent.AscDesktopEditor) {
              return window.parent.AscDesktopEditor;
          }
      } catch (e) {}
      return window.AscDesktopEditor || null;
  }

  // The Nextcloud file ID of the open document, or null. The editor only knows
  // what the Euro-Office app in Nextcloud put in the editor config:
  // - document.referenceData.fileKey is the file ID;
  // - the callback and download URLs carry a JWT ("doc" parameter) whose
  //   payload has fileId;
  // - or the URL path holds it (/apps/eurooffice/<fileId>).
  function getOpenFileId() {
      var api;
      try {
          api = (window.parent.Asc && window.parent.Asc.editor) || window.parent.editor;
      } catch (e) {
          return null;
      }
      if (!api) return null;

      try {
          var reference = api.DocInfo && api.DocInfo.get_ReferenceData && api.DocInfo.get_ReferenceData();
          if (reference && /^\d+$/.test(String(reference.fileKey))) return String(reference.fileKey);
      } catch (e) {}

      var urls = [api.documentCallbackUrl, api.documentUrl];
      for (var i = 0; i < urls.length; i++) {
          var id = fileIdFromUrl(urls[i]);
          if (id) return id;
      }
      return null;
  }

  function fileIdFromUrl(value) {
      if (!value || typeof value !== "string") return null;
      var url;
      try {
          url = new URL(value, window.location.href);
      } catch (e) {
          return null;
      }

      var token = url.searchParams.get("doc");
      var payload = token && decodeJwtPayload(token);
      var id = payload && (payload.fileId || payload.fileid);
      if (id && /^\d+$/.test(String(id))) return String(id);

      var match = /\/apps\/(?:eurooffice|onlyoffice)\/(\d+)(?:[/?#]|$)/.exec(url.pathname);
      return match ? match[1] : null;
  }

  function decodeJwtPayload(token) {
      var parts = token.split(".");
      if (parts.length !== 3) return null;
      try {
          var base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
          while (base64.length % 4) base64 += "=";
          return JSON.parse(decodeURIComponent(escape(window.atob(base64))));
      } catch (e) {
          return null;
      }
  }

  function openDocInfo() {
      if (docInfoWindow) return;

      docInfoWindow = new window.Asc.PluginWindow();
      attachCommonEvents(docInfoWindow);

      docInfoWindow.attachEvent("onDocInfoReady", function () {
          var fileId = getOpenFileId();
          docInfoWindow.command("onShowDocInfo", fileId
              ? { fileId: fileId }
              : { error: "Pluginet kunne ikke finde filens ID i OpenCase. Er dokumentet åbnet fra OpenCase?" });
      });

      docInfoWindow.show({
          url: "docinfo.html",
          description: "Dokument info",
          isVisual: true,
          isModal: false,
          EditorsSupport: ["word", "cell", "slide", "pdf"],
          size: [720, 720],
          buttons: [
              { text: "Luk", primary: true }
          ]
      });
  }

  function isLocalDesktopFile() {
      var desktop = desktopEditor();
      return !!desktop && typeof desktop.IsLocalFile === "function" && desktop.IsLocalFile();
  }

  function getLoginButton() {
    var loggedIn = window.OpenCaseAuth.isLoggedIn();
    return {
      id: LOGIN_BUTTON_ID,
      type: "big-button",
      text: loginInProgress ? "Logger ind..." : loggedIn ? "Log ud" : "Log ind",
      hint: loggedIn
        ? "Log ud af OpenCase på denne computer"
        : "Log ind på OpenCase i browseren",
      icons: "resources/icons/login.svg",
      disabled: !!loginInProgress,
      lockInViewMode: false,
      enableToggle: false,
      separator: false
    };
  }

  // Placeholders are plain text, so any editor that takes typed text can hold
  // them; the PDF editor is left out.
  function supportsMergeFields() {
      return window.Asc.plugin.info.editorType !== "pdf";
  }

  function mergeFieldItem(value, text, separator) {
      return { id: MERGE_FIELD_ITEM_ID + "_oo_sep_" + value, text: text, separator: !!separator };
  }

  // The editor only gives a button a menu if it has items when it is created,
  // so there is always at least one item.
  function getMergeFieldsButton() {
      var items;
      if (!window.OpenCaseAuth.isLoggedIn()) {
          items = [mergeFieldItem("login", "Log ind for at hente flettefelterne")];
      } else if (mergeFields) {
          mergeFieldList = [];
          items = mergeFields.groups.map(function (group) {
              var subitems = [];
              if (group.note) {
                  // Shown above the fields; clicking it does nothing.
                  subitems.push(mergeFieldItem("note", group.note));
              }
              (group.fields || []).forEach(function (field, index) {
                  mergeFieldList.push(field);
                  subitems.push(mergeFieldItem(
                      mergeFieldList.length - 1,
                      field.placeholder + (field.description ? " – " + field.description : ""),
                      group.note && index === 0
                  ));
              });
              if (!subitems.length) subitems.push(mergeFieldItem("none", "Ingen felter"));
              return { id: MERGE_FIELD_ITEM_ID + "_oo_sep_group", text: group.label, items: subitems };
          });
          items.push(mergeFieldItem("reload", "Genindlæs flettefelter", true));
      } else if (mergeFieldsState === "error") {
          items = [mergeFieldItem("reload", "Flettefelterne kunne ikke hentes. Prøv igen")];
      } else {
          items = [mergeFieldItem("reload", "Henter flettefelter...")];
      }

      return {
          id: MERGE_FIELDS_BUTTON_ID,
          type: "big-button",
          text: "Indsæt flettefelt",
          hint: "Indsæt et flettefelt fra OpenCase ved markøren" +
              (mergeFields && mergeFields.syntax ? ". Felter skrives som " + mergeFields.syntax : ""),
          icons: "resources/icons/merge-field.svg",
          items: items,
          lockInViewMode: true,
          enableToggle: false,
          separator: false
      };
  }

  // GET in the main plugin; the windows use api.js instead.
  async function mainGet(path) {
      // No cookies: see api.js.
      var response = await fetch(window.OpenCaseAuth.apiUrl(path), {
          headers: Object.assign({ Accept: "application/json" }, window.OpenCaseAuth.authHeaders()),
          credentials: "omit"
      });
      if (response.status === 401) {
          window.OpenCaseAuth.clear();
          throw new Error("Login udløbet");
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
  }

  // What depends on the login: the merge fields and the Ny skabelon button.
  // The merge fields are only for template designers, so /me comes first.
  function loadServerData() {
      loadUserInfo().then(function () {
          if (canManageTemplates) loadMergeFields();
      });
      checkDigitalPost();
  }

  // Sending works on the open document, so the buttons are only shown for
  // documents opened from OpenCase. They are disabled until logged in.
  function getSendButtons() {
      var loggedIn = window.OpenCaseAuth.isLoggedIn();
      var dpUnavailable = digitalPostEnabled === false;
      return [
          {
              id: SEND_DIGITAL_POST_BUTTON_ID,
              type: "big-button",
              text: "Send Digital post",
              hint: dpUnavailable
                  ? "Digital Post er ikke tilgængelig på denne server"
                  : "Send dokumentet med Digital Post, eller se status for forsendelsen",
              icons: "resources/icons/digital-post.svg",
              disabled: !loggedIn || dpUnavailable,
              lockInViewMode: false,
              enableToggle: false,
              separator: true
          },
          {
              id: SEND_LINK_BUTTON_ID,
              type: "big-button",
              text: "Send link med email",
              hint: "Send et link til dokumentet i OpenCase med email",
              icons: "resources/icons/email-link.svg",
              disabled: !loggedIn,
              lockInViewMode: false,
              enableToggle: false,
              separator: false
          },
          {
              id: SEND_PDF_BUTTON_ID,
              type: "big-button",
              text: "Send PDF med email",
              hint: "Send dokumentets filer som PDF med email",
              icons: "resources/icons/email-pdf.svg",
              disabled: !loggedIn,
              lockInViewMode: false,
              enableToggle: false,
              separator: false
          }
      ];
  }

  // Disables Send Digital post when the server doesn't offer it
  // (GET /documents/{id}/digital-post: enabled false).
  async function checkDigitalPost() {
      if (isLocalDesktopFile() || !window.OpenCaseAuth.isLoggedIn()) return;
      var openFileId = getOpenFileId();
      if (!openFileId) return;
      try {
          var doc = await mainGet("/files/" + encodeURIComponent(openFileId) + "/document");
          var state = await mainGet("/documents/" + encodeURIComponent(doc.id) + "/digital-post");
          var enabled = !(state && state.enabled === false);
          if (enabled !== digitalPostEnabled) {
              digitalPostEnabled = enabled;
              updateToolbar();
          }
      } catch (error) {
          console.error("OpenCase digital post:", error);
      }
  }

  // One send window at a time: Digital post, or email as link or PDF.
  function openSendWindow(kind) {
      if (sendWindow) {
          window.Asc.plugin.executeMethod("CloseWindow", [sendWindow.id]);
          sendWindow = null;
      }
      var win = new window.Asc.PluginWindow();
      sendWindow = win;
      attachCommonEvents(win);

      win.attachEvent("onSendReady", function () {
          var fileId = getOpenFileId();
          win.command("onShowSend", fileId
              ? { fileId: fileId, variant: kind }
              : { error: "Pluginet kunne ikke finde filens ID i OpenCase." });
      });

      var isDigitalPost = kind === "digital-post";
      win.show({
          url: isDigitalPost ? "digitalpost.html" : "email.html",
          description: isDigitalPost ? "Digital post" : kind === "pdf" ? "Send PDF med email" : "Send link med email",
          isVisual: true,
          isModal: false,
          EditorsSupport: ["word", "cell", "slide", "pdf"],
          size: isDigitalPost ? [760, 640] : [700, 700],
          buttons: [
              { text: "Luk", primary: false }
          ]
      });
  }

  // Ny skabelon is only for users who may manage templates (GET /me).
  async function loadUserInfo() {
      var allowed = false;
      if (window.OpenCaseAuth.isLoggedIn()) {
          try {
              var me = await mainGet("/me");
              allowed = !!(me && me.canManageTemplates);
          } catch (error) {
              console.error("OpenCase /me:", error);
          }
      }
      if (allowed !== canManageTemplates) {
          canManageTemplates = allowed;
          updateToolbar();
      }
  }

  async function loadMergeFields() {
      if (!supportsMergeFields() || !window.OpenCaseAuth.isLoggedIn() || mergeFieldsState === "loading") return;
      mergeFieldsState = "loading";
      mergeFields = null;
      updateToolbar();
      try {
          var data = await mainGet("/templates/fields");
          if (!data || !Array.isArray(data.groups)) throw new Error("Uventet svar fra serveren");
          mergeFields = data;
          mergeFieldsState = "idle";
      } catch (error) {
          console.error("OpenCase merge fields:", error);
          mergeFieldsState = "error";
      }
      updateToolbar();
  }

  function onMergeFieldItem(value) {
      if (value === "login") {
          login().catch(function (error) {
              console.error("OpenCase login:", error);
          });
      } else if (value === "reload") {
          loadMergeFields();
      } else {
          var field = mergeFieldList[Number(value)];
          if (!field) return;
          if (isLogoField(field) && window.Asc.plugin.info.editorType === "word") {
              insertSampleLogo();
          } else {
              // PasteText inserts at the cursor, replacing any selection.
              window.Asc.plugin.executeMethod("PasteText", [field.placeholder]);
          }
      }
  }

  // The logo is an image, not text: OpenCase finds it by its alt text and
  // replaces it with the organisation's logo when it merges the template.
  var LOGO_FIELD = "organisation.logo";

  function isLogoField(field) {
      return [field.en, field.name].some(function (name) {
          return String(name || "").toLowerCase() === LOGO_FIELD;
      });
  }

  function insertSampleLogo() {
      window.Asc.scope.logoSrc = window.OpenCaseSampleLogo;
      window.Asc.scope.logoAlt = "{{" + LOGO_FIELD + "}}";
      window.Asc.plugin.callCommand(function () {
          // 40 x 15 mm, the sample image's aspect ratio (EMU: 36000 per mm).
          var image = Api.CreateImage(Asc.scope.logoSrc, 40 * 36000, 15 * 36000);
          var paragraph = Api.CreateParagraph();
          paragraph.AddDrawing(image);
          // The builder API has no setter for the alt text; set it on the
          // paragraph drawing that wraps the image once it is added (its docPr
          // is the <wp:docPr descr="…"> in the DOCX, shown as "Alternativ tekst").
          var drawing = typeof image.getParaDrawing === "function"
              ? image.getParaDrawing()
              : image.Drawing && image.Drawing.parent;
          if (drawing && drawing.docPr && typeof drawing.docPr.setDescr === "function") {
              drawing.docPr.setDescr(Asc.scope.logoAlt);
          } else {
              console.warn("OpenCase: could not set the logo's alt text");
          }
          // Inline: put the image at the cursor instead of in a new paragraph.
          Api.GetDocument().InsertContent([paragraph], true);
      }, false, true);
  }

  function updateToolbar() {
    window.Asc.plugin.executeMethod("UpdateToolbarMenuItem", [getToolbarItems()]);
  }

  // Shared by the ribbon button and the documents window, so concurrent
  // requests reuse one login flow.
  function login() {
    if (!loginInProgress) {
      loginInProgress = window.OpenCaseAuth.login(openInBrowser)
        .finally(function () {
          loginInProgress = null;
          updateToolbar();
          loadServerData();
        });
      updateToolbar();
    }
    return loginInProgress;
  }

  function onLoginButton() {
    if (loginInProgress) return;
    if (window.OpenCaseAuth.isLoggedIn()) {
      mergeFields = null;
      canManageTemplates = false;
      window.OpenCaseAuth.logout().then(updateToolbar);
      return;
    }
    login().catch(function (error) {
      console.error("OpenCase login:", error);
    });
  }

  function openOpenCase() {
    openInBrowser(window.OpenCaseSettings.getUrl());
  }

  function openInBrowser(url) {
    // No "noopener" feature: it makes window.open return null, hiding real failures.
    var win = window.open(url, "_blank");
    if (win) {
      win.opener = null;
    } else if (window.AscDesktopEditor && window.AscDesktopEditor.openExternalReference) {
      // Desktop editors may block window.open; hand the link to the OS browser.
      window.AscDesktopEditor.openExternalReference(url);
    }
  }

  function openSettings() {
    if (settingsWindow) return;

    settingsWindow = new window.Asc.PluginWindow();
    settingsWindow.show({
      url: "settings.html",
      description: "OpenCase settings",
      isVisual: true,
      isModal: true,
      EditorsSupport: ["word", "cell", "slide", "pdf"],
      size: [420, 160],
      buttons: [
        { text: "Save", primary: true },
        { text: "Cancel", primary: false }
      ]
    });

    settingsWindow.attachEvent("onSettingsSave", function (data) {
      if (data && window.OpenCaseSettings.isValidUrl(data.url)) {
        window.OpenCaseSettings.setUrl(data.url);
        closeSettings();
        // Logins are stored per server, so the button state may change.
        mergeFields = null;
        canManageTemplates = false;
        updateToolbar();
        loadServerData();
      }
    });
  }

  function isOpen(win) {
      return win !== null &&
          (win === documentsWindow || win === searchWindow || win === saveWindow ||
              win === docInfoWindow || win === templatesWindow || win === newTemplateWindow ||
              win === fromTemplateWindow || win === sendWindow);
  }

  // Handlers shared by the documents and search windows.
  function attachCommonEvents(win) {
      win.attachEvent(
          "onOpenUrl",
          function (data) {
              if (data && window.OpenCaseSettings.isValidUrl(data.url)) {
                  openInBrowser(data.url);
              }
          }
      );

      win.attachEvent(
          "onLogin",
          function () {
              login().then(
                  function () {
                      if (isOpen(win)) win.command("onLoggedIn", null);
                  },
                  function (error) {
                      if (isOpen(win)) win.command("onLoginFailed", { error: error.message });
                  }
              );
          }
      );

      // The window can't read the login itself (see api.js): hand it over.
      win.attachEvent(
          "onAuthRequest",
          function () {
              if (isOpen(win)) win.command("onAuth", window.OpenCaseAuth.get());
          }
      );

      // The window got a 401: the app password was revoked or expired.
      win.attachEvent(
          "onLoggedOut",
          function () {
              window.OpenCaseAuth.clear();
              canManageTemplates = false;
              updateToolbar();
          }
      );

      win.attachEvent(
          "onOpenDocument",
          function (data) {
              var editorUrl = data.editorUrl;

              try {
                  if (!editorUrl) {
                      throw new Error("Dokumentet har ingen editorUrl");
                  }

                  openDocumentInDesktop(editorUrl, data.name);

                  win.command(
                      "onDesktopApiTest",
                      {
                          fileId: data.fileId,
                          editorUrl: editorUrl,
                          commandExecuted: true
                      }
                  );
              } catch (error) {
                  win.command(
                      "onDesktopApiTest",
                      {
                          commandExecuted: false,
                          error: error.message
                      }
                  );
              }
          }
      );
  }

  function openSearch() {
      if (searchWindow) return;

      searchWindow = new window.Asc.PluginWindow();
      attachCommonEvents(searchWindow);

      searchWindow.show({
          url: "search.html",
          description: "Søg i OpenCase",
          isVisual: true,
          isModal: false,
          EditorsSupport: ["word", "cell", "slide", "pdf"],
          size: [960, 640],
          buttons: [
              { text: "Luk", primary: true }
          ]
      });
  }

  function openFromTemplate() {
      if (fromTemplateWindow) return;

      fromTemplateWindow = new window.Asc.PluginWindow();
      attachCommonEvents(fromTemplateWindow);

      // The dialog offers the open file's document when it is from OpenCase.
      fromTemplateWindow.attachEvent("onFromTemplateReady", function () {
          fromTemplateWindow.command("onShowFromTemplate", {
              fileId: isLocalDesktopFile() ? null : getOpenFileId()
          });
      });

      fromTemplateWindow.attachEvent("onFileFromTemplateCreated", function (file) {
          try {
              openDocumentInDesktop(file.editorUrl, file.name);
          } catch (error) {
              fromTemplateWindow.command("onDesktopApiTest", { commandExecuted: false, error: error.message });
              return;
          }
          closeFromTemplate();
      });

      // The dialog has its own "Opret og rediger" button, so it can be
      // disabled while the server merges the template.
      fromTemplateWindow.show({
          url: "fromtemplate.html",
          description: "Ny fil fra skabelon",
          isVisual: true,
          isModal: true,
          EditorsSupport: ["word", "cell", "slide", "pdf"],
          size: [700, 700],
          buttons: [
              { text: "Annuller", primary: false }
          ]
      });
  }

  function closeFromTemplate() {
      if (!fromTemplateWindow) return;
      window.Asc.plugin.executeMethod("CloseWindow", [fromTemplateWindow.id]);
      fromTemplateWindow = null;
  }

  function openNewTemplate() {
      if (newTemplateWindow) return;

      newTemplateWindow = new window.Asc.PluginWindow();
      attachCommonEvents(newTemplateWindow);

      // A new blank template is opened straight away, so the user can write it.
      newTemplateWindow.attachEvent("onTemplateCreated", function (template) {
          try {
              openDocumentInDesktop(template.editorUrl, template.originalFilename || template.name);
          } catch (error) {
              newTemplateWindow.command("onDesktopApiTest", { commandExecuted: false, error: error.message });
              return;
          }
          closeNewTemplate();
      });

      newTemplateWindow.show({
          url: "newtemplate.html",
          description: "Ny skabelon",
          isVisual: true,
          isModal: true,
          EditorsSupport: ["word", "cell", "slide", "pdf"],
          size: [680, 640],
          buttons: [
              { text: "Opret", primary: true },
              { text: "Annuller", primary: false }
          ]
      });
  }

  function closeNewTemplate() {
      if (!newTemplateWindow) return;
      window.Asc.plugin.executeMethod("CloseWindow", [newTemplateWindow.id]);
      newTemplateWindow = null;
  }

  function openTemplates() {
      if (templatesWindow) return;

      templatesWindow = new window.Asc.PluginWindow();
      attachCommonEvents(templatesWindow);

      templatesWindow.show({
          url: "templates.html",
          description: "Åbn skabelon",
          isVisual: true,
          isModal: false,
          EditorsSupport: ["word", "cell", "slide", "pdf"],
          size: [640, 520],
          buttons: [
              { text: "Luk", primary: true }
          ]
      });
  }

  function openSaveDialog() {
      if (saveWindow) return;

      saveWindow = new window.Asc.PluginWindow();
      attachCommonEvents(saveWindow);

      // The file is on the server now: continue editing the server copy and
      // close the local one, so changes are not saved to the wrong file.
      saveWindow.attachEvent("onSavedInOpenCase", function (data) {
          try {
              openDocumentInDesktop(data.file.editorUrl, data.file.name);
          } catch (error) {
              saveWindow.command("onDesktopApiTest", { commandExecuted: false, error: error.message });
              return;
          }
          closeSaveDialog();
          closeLocalDocument();
      });

      saveWindow.show({
          url: "save.html",
          description: "Gem i OpenCase",
          isVisual: true,
          isModal: true,
          EditorsSupport: ["word", "cell", "slide", "pdf"],
          size: [620, 640],
          buttons: [
              { text: "Gem", primary: true },
              { text: "Annuller", primary: false }
          ]
      });
  }

  function closeSaveDialog() {
      if (!saveWindow) return;
      window.Asc.plugin.executeMethod("CloseWindow", [saveWindow.id]);
      saveWindow = null;
  }

  // Same command the editor's own "Close file" button sends; the desktop app
  // closes the tab or window the command comes from.
  function closeLocalDocument() {
      var desktop = window.AscDesktopEditor || (window.parent && window.parent.AscDesktopEditor);
      if (desktop && typeof desktop.execCommand === "function") {
          desktop.execCommand("editor:event", JSON.stringify({ action: "file:close" }));
      }
  }

  function openDocumentList(type) {
      documentsType = type;

      // Reuse an open window: switch it to the requested list.
      if (documentsWindow) {
          documentsWindow.command("onShowDocuments", { type: type });
          return;
      }

      documentsWindow = new window.Asc.PluginWindow();

      documentsWindow.attachEvent(
          "onDocumentsReady",
          function () {
              documentsWindow.command("onShowDocuments", { type: documentsType });
          }
      );

      attachCommonEvents(documentsWindow);

      documentsWindow.show({
          url: "documents.html",
          description: "OpenCase dokumenter",
          isVisual: true,
          isModal: false,
          EditorsSupport: ["word", "cell", "slide", "pdf"],
          size: [720, 480],
          buttons: [
              { text: "Luk", primary: true }
          ]
      });
  }

  // Desktop file format ids (AVS_OFFICESTUDIO_FILE_*); they pick the editor
  // window type. 0 lets the desktop app guess from the URL.
  var DESKTOP_FORMATS = { docx: 65, xlsx: 257, pptx: 129, pdf: 513 };

  function openDocumentInDesktop(editorUrl, name) {
      // inframe/parentOrigin are for embedding the editor in the OpenCase web UI;
      // in a desktop editor tab or a browser tab the page must run standalone.
      var url = new URL(editorUrl);
      url.searchParams.delete("inframe");
      url.searchParams.delete("parentOrigin");

      var desktop = window.AscDesktopEditor || desktopEditor();
      if (!desktop || typeof desktop.execCommand !== "function") {
          // In a browser: open the OpenCase editor page in a new tab.
          openInBrowser(url.toString());
          return;
      }

      var ext = (name || "").split(".").pop().toLowerCase();

      // "open:document" is a no-op in the desktop app. "open:recent" with id -1
      // and an http(s) path loads that URL in a new editor tab/window.
      desktop.execCommand("open:recent", JSON.stringify({
          id: -1,
          name: name || "",
          path: url.toString(),
          type: DESKTOP_FORMATS[ext] || 0,
          cloud: "opencase",
          recovery: false
      }));
  }

  function closeSettings() {
    if (!settingsWindow) return;
    window.Asc.plugin.executeMethod("CloseWindow", [settingsWindow.id]);
    settingsWindow = null;
  }

  window.Asc.plugin.init = function () {
    // Load the merge fields once the ribbon exists, so the update reaches it.
    this.executeMethod("AddToolbarMenuItem", [getToolbarItems()], loadServerData);
    this.attachToolbarMenuClickEvent(OPEN_BUTTON_ID, openOpenCase);
    this.attachToolbarMenuClickEvent(SETTINGS_BUTTON_ID, openSettings);

    this.attachToolbarMenuClickEvent(
      FAVORITES_BUTTON_ID,
      function () {
        openDocumentList("favorites");
      }
    );

    this.attachToolbarMenuClickEvent(
      RECENT_BUTTON_ID,
      function () {
        openDocumentList("recent");
      }
    );

    this.attachToolbarMenuClickEvent(
      MY_DOCUMENTS_BUTTON_ID,
      function () {
        openDocumentList("my-documents");
      }
    );

    this.attachToolbarMenuClickEvent(SEARCH_BUTTON_ID, openSearch);
    this.attachToolbarMenuClickEvent(FROM_TEMPLATE_BUTTON_ID, openFromTemplate);
    this.attachToolbarMenuClickEvent(SEND_DIGITAL_POST_BUTTON_ID, function () { openSendWindow("digital-post"); });
    this.attachToolbarMenuClickEvent(SEND_LINK_BUTTON_ID, function () { openSendWindow("link"); });
    this.attachToolbarMenuClickEvent(SEND_PDF_BUTTON_ID, function () { openSendWindow("pdf"); });
    this.attachToolbarMenuClickEvent(SAVE_BUTTON_ID, openSaveDialog);
    this.attachToolbarMenuClickEvent(DOCINFO_BUTTON_ID, openDocInfo);
    this.attachToolbarMenuClickEvent(TEMPLATES_BUTTON_ID, openTemplates);
    this.attachToolbarMenuClickEvent(NEW_TEMPLATE_BUTTON_ID, openNewTemplate);
    this.attachToolbarMenuClickEvent(MERGE_FIELD_ITEM_ID, onMergeFieldItem);
    this.attachToolbarMenuClickEvent(LOGIN_BUTTON_ID, onLoginButton);
  };

  // Footer buttons of the settings window: 0 = Save, 1 = Cancel, -1 = close (X).
  window.Asc.plugin.button = function (id, windowId) {
    if (documentsWindow && windowId === documentsWindow.id) {
      window.Asc.plugin.executeMethod(
        "CloseWindow",
        [documentsWindow.id]
      );
      documentsWindow = null;
      return;
    }

    if (docInfoWindow && windowId === docInfoWindow.id) {
      window.Asc.plugin.executeMethod("CloseWindow", [docInfoWindow.id]);
      docInfoWindow = null;
      return;
    }

    if (templatesWindow && windowId === templatesWindow.id) {
      window.Asc.plugin.executeMethod("CloseWindow", [templatesWindow.id]);
      templatesWindow = null;
      return;
    }

    if (searchWindow && windowId === searchWindow.id) {
      window.Asc.plugin.executeMethod("CloseWindow", [searchWindow.id]);
      searchWindow = null;
      return;
    }

    if (sendWindow && windowId === sendWindow.id) {
      window.Asc.plugin.executeMethod("CloseWindow", [sendWindow.id]);
      sendWindow = null;
      return;
    }

    if (fromTemplateWindow && windowId === fromTemplateWindow.id) {
      closeFromTemplate();
      return;
    }

    // New template dialog: 0 = Opret, 1 = Annuller, -1 = close (X).
    if (newTemplateWindow && windowId === newTemplateWindow.id) {
      if (id === 0) {
        newTemplateWindow.command("onSave", null);
      } else {
        closeNewTemplate();
      }
      return;
    }

    // Save dialog: 0 = Gem, 1 = Annuller, -1 = close (X).
    if (saveWindow && windowId === saveWindow.id) {
      if (id === 0) {
        saveWindow.command("onSave", null);
      } else {
        closeSaveDialog();
      }
      return;
    }

    if (!settingsWindow || windowId !== settingsWindow.id) return;

    if (id === 0) {
      settingsWindow.command("onSave", null);
    } else {
      closeSettings();
    }
  };
})(window);
