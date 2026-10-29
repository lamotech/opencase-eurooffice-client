# OpenCase plugin for Euro-Office

Adds an **OpenCase** tab to the editor ribbon (Document, Spreadsheet, Presentation and PDF editors) with:

- **Open OpenCase**: opens the OpenCase website in a new browser tab.
- **Settings**: a dialog for changing the URL.

## Configuring the URL

- **Default for every user:** change `DEFAULT_URL` in [scripts/settings.js](scripts/settings.js). It is set to `https://dev04.opencase.dk/`.
- **Per user:** click **OpenCase → Settings**, enter a URL and click **Save**. The URL is saved in the browser's `localStorage`. Click **Reset to default** to go back to `DEFAULT_URL`.

## Install

The editor must be version 8.1 or later, because the plugin uses the `AddToolbarMenuItem` API.

- **Desktop app (Windows):** run `install-plugin.ps1`. It copies the plugin into
  `%LOCALAPPDATA%\Euro-Office\DesktopEditors\data\sdkjs-plugins\{0CCBED17-288E-417C-8A84-26832C7AF9D2}\`. Restart Euro-Office afterwards.
  Run `install-plugin.ps1 -Uninstall` to remove it. This install has no built-in plugins, so the Plugins tab stays hidden until a plugin is installed.
- **Document Server, package install (needed for documents opened from OpenCase):** the desktop app does not load its locally installed plugins into documents that come from a Document Server. So the OpenCase tab only appears in OpenCase documents if the plugin is installed on the Document Server that OpenCase uses.
  1. On Windows, run `package-plugin.ps1`. It creates `dist\opencase-plugin.zip`.
  2. Copy the zip to the server, then run:
     `unzip opencase-plugin.zip -d opencase-plugin && cd opencase-plugin && sudo sh install-server.sh --url https://dev03.opencase.dk/`
  3. Close and reopen the document.

  `install-server.sh` finds the Document Server's web root (the folder with `web-apps` and `sdkjs`, not the config folder in `/etc`). It tries the usual `/var/www/…/documentserver` paths, then the folder nginx serves the editors from, and finally a search. Use `--dir` to give the location yourself. It creates `sdkjs-plugins` if it doesn't exist yet. `--url` sets the default OpenCase server, and `--uninstall` removes the plugin. On the Document Server, **Gem i OpenCase** is hidden, because the document is already in OpenCase. The plugin has its own login there, separate from the desktop app's local plugin.
- **Server (all users):** copy this folder into the Document Server plugins directory, e.g.
  `/var/www/onlyoffice/documentserver/sdkjs-plugins/{0CCBED17-288E-417C-8A84-26832C7AF9D2}/`,
  then restart the Document Server or run `documentserver-pluginsmanager.sh` with `-r false --update`.
- **Single user:** zip the folder's contents (`config.json` at the top level of the zip), rename the zip to `opencase.plugin`, and add it under **Plugins → Plugin Manager → Install plugin manually**.

- **Through the editor config (works without a Plugins tab):** host this folder on any web server the browser can reach, then add the following to the config your integration passes to `new DocsAPI.DocEditor(...)`:

  ```js
  editorConfig: {
    customization: { plugins: true },
    plugins: {
      autostart: ["asc.{0CCBED17-288E-417C-8A84-26832C7AF9D2}"],
      pluginsData: ["https://your-host/opencase-plugin/config.json"]
    }
  }
  ```

The plugin is a *system* plugin (`"type": "system"` in `config.json`). The editor starts it automatically and doesn't list it in the Plugins tab.

It is deliberately not a *background* plugin. In the Euro-Office desktop editor (web-apps), when the only installed plugins are background plugins, the editor crashes with `Cannot read properties of undefined (reading 'show')` in `onResetPlugins`. The reason is that the "Background plugins" button is only created while the editor adds a regular plugin button.

If there is no **Plugins** tab at all, the integration has probably turned plugins off with `editorConfig.customization.plugins: false`, or there are no plugins installed. The Document Server hides the tab in both cases.

## Login and backend API

The plugin logs in with [Nextcloud Login Flow v2](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2). This works the same whether a customer logs in with a Nextcloud password, Entra ID (OIDC) or KOMBIT (SAML):

1. **Log ind** (on the ribbon or in the documents window) calls `POST …/login`.
2. The login URL is opened in the browser. The user logs in there and clicks **Grant access**.
3. The plugin polls `poll.endpoint` until it receives an app password. The app password is stored in `localStorage`, per server URL.
4. Every API call sends `Authorization: Basic base64(loginName:appPassword)`.
5. **Log ud** deletes the stored app password and calls `POST …/logout`.

The plugin runs from a local file, so its requests come from origin `null`. Every endpoint therefore has to send CORS headers.

### Endpoints the OpenCase app must provide

All endpoints are under `/index.php/apps/opencase/desktop/v1/api`.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /login` | none | empty | `{ "login": "<url>", "poll": { "token": "…", "endpoint": "<url of POST /login/poll>" } }` |
| `POST /login/poll` | none | form field `token` | `404` while waiting for the user. `200 { "server", "loginName", "appPassword" }` once access is granted |
| `POST /logout` | Basic | empty | `200`. Revokes the app password that was used (optional; the plugin forgets the password either way) |
| `GET /documents/favorites` | Basic | none | document list, see below |
| `GET /documents/recent` | Basic | none | document list, see below |
| `GET /documents/my-documents` | Basic | none | document list, see below |
| `GET /cases` | Basic | `search`, `limit` | cases the user can read. Used by **Gem i OpenCase**; only cases with `canWrite` can be picked |
| `GET /document-categories`, `GET /document-types`, `GET /insight-levels` | Basic | none | `[{ id, name, description? }]` |
| `POST /documents` | Basic | JSON: `caseId`, `title`, `documentCategoryId`, `documentType`, `insightLevelId`, `documentDate`, `receivedDate`, `registeredDate`, `summary` | `201` with the new document |
| `POST /documents/{id}/files` | Basic | multipart: `file` | `201 { fileId, name, editorUrl }` |
| `GET /files/{fileId}/document` | Basic | none | the document of a file, with all metadata. Used by **Dokument info** |
| `GET /templates` | Basic | `search`, `caseId` | `[{ id, name, originalFilename, mimeType, size, createdAt, uploadedBy, canEdit, fileId, editorUrl }]`, newest first. Used by **Åbn skabelon**; `editorUrl` (set when `canEdit`) opens the template itself, so saving changes it for everyone |
| `GET /me` | Basic | none | `{ id, displayName, isOpenCaseUser, canManageTemplates, canSendDigitalPost }`. Only Indstillinger, Log ind/ud and Åbn OpenCase are shown until the user is logged in with `isOpenCaseUser` `true`; `false` or a `403` shows **Ingen adgang** (the login is kept). The template and phrase buttons need `canManageTemplates`, **Send Digital post** needs `canSendDigitalPost` |
| `GET /organisations` | Basic | none | `[{ uuid, name, parentUuid, depth }]` in display order |
| `GET /phrases` | Basic | `orgUuids` (comma-separated), `templateFormat` (`blank`, `docx`, `odt`, `xlsx`, `ods`) | `[{ id, title, description, categoryPath, status, fileFormat, formatNote }]` |
| `POST /templates` | Basic | JSON `{ name, orgUuids, phrases: [{ phraseId, isRequired, isDefault }] }` for a blank file, or multipart `file`, `name`, `orgUuids` and `phrases` (JSON strings) for an upload | `201` with the template, as in `GET /templates`. `400 { error }` shown as it is, `403` without template rights |
| `GET /document-statuses` | Basic | none | `[{ id, name, isFinal }]`. Used by **Dokument info** |
| `PUT /documents/{id}/status` | Basic | JSON `{ status }` | `{ status: { id, name, isFinal } }` |
| `PUT` / `DELETE /documents/{id}/favorite` | Basic | none | `{ isFavorite }` |
| `GET /documents/{id}/contacts` | Basic | none | `[{ id, role, type, name, cprCvr, pnumber, phone, email, addressProtected, address }]` |
| `POST /documents/{id}/contacts` | Basic | JSON `{ roleId, cprCvr, pnumber }`, or `name` and the other fields for a contact entered by hand | `201` with the contact. `404` number not found, `409` already added with that role |
| `DELETE /documents/{id}/contacts/{contactId}` | Basic | none | removes the contact |
| `POST /documents/{id}/contacts/{contactId}/address` | Basic | none | `{ address }` of a protected address; logged on every call |
| `GET /contact-roles` | Basic | none | `[{ id, name }]` |
| `GET /citizens/search`, `GET /companies/search` | Basic | `cpr` or `firstname`, `lastname`, `streetname`, `housenumber`, `zipcode`, `zipdistrict` / `cvr` (+ `pnumbers=1`) or `name` | `{ source, results }` |
| `GET`, `POST /documents/{id}/notes`, `PUT`, `DELETE /documents/{id}/notes/{noteId}` | Basic | JSON `{ title, text }` | the notes, or the note |
| `GET /documents/{id}/digital-post` | Basic | none | `{ enabled, canSend, inProgress, shipment }`. Used by **Send Digital post**, polled every 10 s while `inProgress` |
| `GET /documents/{id}/digital-post/draft` | Basic | none | `{ canSend, canBeReplied, includeAttachments, mainFileId, files, attachments, receivers }` |
| `GET /documents/{id}/contacts/{contactId}/digital-post-subscription` | Basic | none | `{ hasSubscription }` (`null` if it couldn't be checked) |
| `POST /documents/{id}/digital-post` | Basic | JSON `{ mainFileId, canBeReplied, includeAttachments }` | `201`, as `GET …/digital-post`. `400`, `409` already sent, `501` not enabled |
| `GET /digital-post/files/{id}/pdf`, `GET /digital-post/receivers/{id}/pdf` | Basic | none | the PDF that was sent |
| `GET /email/account` | Basic | none | `{ mailAppEnabled, configured, from }`. Used by **Send link/PDF med email** |
| `GET /documents/{id}/email/recipients` | Basic | `q` (2+ characters) | recipients to pick, sent back as they are |
| `POST /documents/{id}/email/access` | Basic | JSON `{ emails }` | `[{ email, documentAccess }]` for typed addresses |
| `POST /documents/{id}/email/link`, `POST /documents/{id}/email/pdf` | Basic | JSON `{ to, cc, bcc, subject, bodyHtml, saveAsDocument }` (+ `fileIds` for PDF) | `{ sent, attachments }`. `400`, `412` no Mail account, `422` conversion failed, `502` mail server refused |
| `GET /phrases` | Basic | `search`, `status`, `orgUuids`, `templateFormat` | phrases sorted by category path and title. Used by **Åbn frase**, **Frase info** and **Indsæt frase** (and by **Ny skabelon**) |
| `GET /phrases/{id}`, `PUT /phrases/{id}` | Basic | JSON with any of `title`, `description`, `content`, `categoryId`, `status`, `scopes` | the phrase with `content`, `scopes`, `templates`. Used by **Frase info** |
| `POST /phrases` | Basic | JSON (`blankFile: true` for a file to write in the editor, or `content`), or multipart with `file` | `201` with the phrase; `fileError` if only the file failed. Used by **Ny frase** |
| `POST /phrases/{id}/file` | Basic | multipart `file`, or JSON `{ blank: true }` | the phrase, with `editorUrl` |
| `GET /phrases/{id}/content` | Basic | none | `{ source, html, text, fileUrl }`. Used by **Indsæt frase** |
| `GET /phrase-categories`, `GET /case-types` | Basic | none | categories in tree order with `depth`; case types `[{ id, name }]` |
| `GET /templates/{id}/phrases` | Basic | `documentId` or `caseId` | `[{ phraseId, title, description, categoryPath, isRequired, isDefault }]` in the template's order. Used by **Ny fil fra skabelon** |
| `POST /documents/{id}/files/from-template` | Basic | JSON `{ templateId, filename, phraseIds }` | `201 { fileId, name, editorUrl, document }`. `400`/`404` with `error`, `500` when the merge fails |
| `GET /templates/fields` | Basic | none | `{ syntax, groups: [{ key, label, note, fields: [{ name, placeholder, da, en, description }] }] }`. Used by the **Indsæt flettefelt** menu, which inserts `placeholder` at the cursor |
| `GET /documents/fulltextsearch` | Basic | `q`, `organisation`, `case_type`, `document_type`, `year`, `limit`, `offset` | `{ query, filters, total, limit, offset, facets, files }`. Used by the **Søg** dialog |

Implementation notes:
- **Login wrappers:** `/login` and `/login/poll` only exist because Nextcloud's own `/index.php/login/v2` and `/login/v2/poll` don't send CORS headers. The wrappers can forward to them server-side and return the same JSON. In the `/login` response, `poll.endpoint` must point to the wrapper's `/login/poll`, not to core's poll URL.
- **CORS:** mark the actions `#[CORS]`, `#[NoCSRFRequired]` and `#[NoAdminRequired]` (the login wrappers also need `#[PublicPage]`). Add an `OPTIONS` preflight route for the `Authorization` header, for example `['name' => 'desktopApi#preflighted_cors', 'url' => '/desktop/v1/api/{path}', 'verb' => 'OPTIONS', 'requirements' => ['path' => '.+']]` on an `ApiController`.
- **Authentication:** Nextcloud authenticates app passwords sent as Basic auth by itself. `#[CORS]` routes reject cookie sessions on purpose.

A document list is a JSON array, or `{ "documents": [...] }`:

```json
[
  {
    "id": 6,
    "documentnumber": "2026-00003-1",
    "title": "Kommunens styrelse i almindelighed",
    "url": "https://<server>/apps/opencase/document/6",
    "files": [
      { "fileId": 2911, "name": "Kommunens styrelse i almindelighed.docx", "editorUrl": "https://<server>/index.php/apps/eurooffice/2911?filePath=…" }
    ]
  }
]
```

## DMS provider (desktop app)

[providers/opencase/](providers/opencase/) adds **OpenCase** to the desktop app's list of cloud providers. You reach the list from **Connect to cloud** (the **+** next to **Clouds**). OpenCase runs on Nextcloud, so the provider config mirrors the bundled Nextcloud provider:

- `check.url`: `status.php`, which Nextcloud answers with JSON. The app uses it to confirm that the address it was given is an OpenCase server.
- `editorPage`: `/apps/eurooffice/`. URLs under this path are opened as documents in the desktop editor. Change it if OpenCase serves its editor under another app path.
- To skip the address prompt and always connect to one server, add `"entryPage": "https://dev04.opencase.dk/"`.

Install it by running `install-provider.ps1`. The script asks for administrator rights because it copies into `C:\Program Files\Euro-Office\DesktopEditors\providers\`. Then restart Euro-Office.

The icons in `providers/opencase/assets/` are placeholders: 36×36 list icons and 148×38 button logos, each in a light and a dark version.

## Notes

- `plugins.js` is loaded from `onlyoffice.github.io`. If your installation has no internet access, point the `<script>` tags in `index.html` and `settings.html` at a local copy, e.g. `../v1/plugins.js` when the plugin is installed in `sdkjs-plugins`.



-----------------------------------
On "Gem i OpenCase" dialog:
Add 2 tabs:
"Info" - with the current fields
"Afsendere/modtagere" - as Afsendere/modtagere on Document info dialog where user can add contacts.


-----------------------------------
On "Ny fil fra skabelon" dialog:
When user chooses "Nyt dokument på en sag" it must show the same 2 tabs and fields as on "Gem i OpenCase"

