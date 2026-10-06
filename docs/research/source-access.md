# Source access from extensions: local files and WebDAV

Research for [#4](https://github.com/maxdubmors/rimlock/issues/4). Feeds the decisions in #13 and #14. This document makes no decision.
State of sources: October 2026 (Chromium `main` as of 2026-10-05, MDN browser-compat-data 8.1.4 of 2026-10-01).

## Question

What can an Extension actually do to read and write a Database from each Source?

- **Local file**: Can a Chrome `FileSystemFileHandle` be persisted and reused from popup, side panel, offscreen document and service worker? What are the re-prompt rules, and how is external modification detected? What does Firefox offer (OPFS, `downloads`, anything else)? What does Safari offer?
- **WebDAV**: Fetching from extension contexts (CORS vs host permissions, optional host permissions). Auth (Basic, Digest, Nextcloud app passwords) and what it means for credential storage. ETag / If-Match / Last-Modified support in common servers. Atomic write patterns. How KeePassXC, KeeWeb, Strongbox and KeePassDX sync.

## Summary

### Local file, per browser

| Capability | Chrome (MV3) | Firefox (MV3) | Safari |
|---|---|---|---|
| Pick a user file and keep a handle | Yes. `showOpenFilePicker()` returns a `FileSystemFileHandle`, which can be stored in IndexedDB [1][2] | No. `showOpenFilePicker` is not implemented [2] and Mozilla's position is *negative* [9] | No. Not implemented [2]; WebKit position is *oppose* [10] |
| Read | `handle.getFile()` | `<input type=file>` gives a one-shot `File` with no handle | `<input type=file>` gives a one-shot `File` |
| Write back in place | `createWritable()`. Writes go to `<name>.crswap` in the same directory, which replaces the target on `close()` [6] | No. `downloads.download()` can only write relative to the Downloads directory, or through a Save As dialog on every save [11] | No `downloads` API [2]. A write needs the native app extension (`sendNativeMessage`) [13] |
| Access after a browser restart | The handle survives in IndexedDB. Permission must be re-requested with `requestPermission()`, which needs user activation [3][4]. The "Allow on every visit" persistence only applies to origins with the extended-permission content setting or an installed web app [4]. In a popup or side panel (no request manager) Chrome ≥143 auto-grants instead of prompting [4][5] | n/a | n/a |
| Detecting external change | Poll `getFile()` for `lastModified` and `size`. `FileSystemObserver` is stable but exposed only to Window, DedicatedWorker and SharedWorker, not to service workers [7][8] | Re-import only | Re-import only |
| Private storage for a cached copy | OPFS or IndexedDB | OPFS (Firefox 111+) or IndexedDB [2] | OPFS (15.2+) or IndexedDB [2] |
| File picker inside the toolbar popup | Works. The M143 fix targets exactly this case [5] | The popup closes when a file picker opens (Bugzilla 1292701 and 1378527, both still NEW) [12] | Not examined |

### WebDAV, per server

| Server | ETag | `If-Match` on PUT enforced (412) | Server-side atomic PUT | Notes |
|---|---|---|---|---|
| Nextcloud (sabre/dav) | Yes, quoted. PUT also returns `OC-ETag` [20][22] | **Yes**. sabre `checkPreconditions` runs on every method [21] | **Yes**. Writes `.ocTransferId<n>.part` and renames it over the target (when the storage needs part files) [22] | Basic auth with an app password. Login Flow v2 [23]. CSRF check applies if session cookies are sent [24] |
| ownCloud Infinite Scale (reva) | Yes (`ETag`, `OC-ETag`) [25] | **Yes**. `If-Match` is passed to upload initiation, 412 on mismatch [25] | Not verified | ownCloud 10 "classic" is sabre-based but was not verified separately |
| Apache httpd `mod_dav_fs` | Yes (`ap_make_etag_ex`) [26] | **Yes**. `dav_meets_conditions` → `ap_meets_conditions` [27] | **Yes**. Writes `.davfs.tmp*` and renames it [26] | Digest auth is MD5 only, and Apache recommends Basic over TLS instead [31] |
| nginx `ngx_http_dav_module` | ETag on static GET | **No**. `If-Match` is only checked in the not-modified header filter for status 200, after the PUT has already written (201/204) [28][29] | Yes. Request body temp file plus `ngx_ext_rename_file` [28] | Stock module has no PROPFIND or LOCK (methods: PUT, DELETE, MKCOL, COPY, MOVE) [28] |
| rclone `serve webdav` (golang.org/x/net/webdav) | ModTime+size, or a hash with `--etag-hash` [30] | **No**. A `TODO` in `handlePut`, and ETag conditions in the `If:` header are also unimplemented [30] | **No** at the handler level. Opens the target with `O_TRUNC` [30] | In-memory LOCK only |
| Synology WebDAV Server | Unverified (closed source) | Unverified | Unverified | Needs a live probe |
| Koofr | Unverified (closed source) | Unverified | Unverified | Requires an app-specific password [32] |
| Yandex Disk | Unverified (closed source) | Unverified | Unverified | Needs a live probe |

**Headline facts**

1. Chrome is the only browser where an Extension can hold a reusable read/write handle to a user file. Firefox and Safari can import a copy and cannot write it back in place without help: Downloads-folder writes or a Save As dialog on Firefox, and the native app extension on Safari.
2. Chrome's permission behaviour for `chrome-extension://` origins differs from that of web pages. The differences come from source reading, not from documentation, and need a prototype to confirm (see Open risks).
3. Only Nextcloud, ownCloud oCIS and Apache enforce `If-Match` on PUT, and those were the only ones verified. nginx and rclone ignore it silently. A conditional PUT is therefore not a safe conflict guard unless the server has been probed first.
4. The prior art never uses `If-Match`. KeeWeb compares `Last-Modified` and then does PUT temp + MOVE. Strongbox compares the PROPFIND modification date and then does a plain PUT. Both leave a check-then-write race. Both resolve conflicts by merging.

## Findings

### 1. Chrome: File System Access from extension contexts

- **Handles persist.** "File handles and directory handles are serializable, which means that you can save a file or directory handle to IndexedDB, or call `postMessage()`" [1]. `FileSystemHandle`, including `queryPermission`/`requestPermission`, is `Exposed=(Window,Worker)` in both the spec IDL [3] and Blink's IDL [8]. A service worker can therefore read a stored handle and call `queryPermission()`, `getFile()` and `createWritable()` once a grant exists.
- **`requestPermission()` needs transient activation.** The spec says so [3], and Chromium enforces it: "No permission prompts without user activation" returns `kNoUserActivation`, and a request with no frame ("Requested from a worker") returns `kInvalidFrame` [4]. A service worker can query permission but cannot request it.
- **Extension popups and side panels are auto-granted.** Since commit `ecb8364` (crrev 7025212, landed at main@{#1527946}, which falls between the M142 and M143 branch points, so it ships in **Chrome 143**) [5][34]: "Extension popup WebContents lack a FileSystemAccessPermissionRequestManager, causing RequestPermission() to return kRequestAborted after file/folder selection. This CL auto-grants permission for chrome-extension:// origins when no manager is present." The current code comment says "Extension contexts (popup, side panel) may not have a permission request manager attached" [4]. A context opened as a normal tab has a request manager, so it gets the normal prompt. *Inference, not yet tested:* `requestPermission()` with a user gesture in a popup or side panel on a handle restored from IndexedDB also takes this branch, so it would succeed without any visible prompt.
- **Persistent ("Allow on every visit") permissions** shipped in Chrome 122 with "no developer-facing changes" [1b]. In code, extended (cross-session) grants apply only if `OriginHasExtendedPermission()` is true. That requires the `FILE_SYSTEM_ACCESS_EXTENDED_PERMISSION` content setting to be ALLOW, or an installed web app with OS integration [4]. A `chrome-extension://` origin is not a web app, so by default its grants are not extended.
- **When grants are revoked.** Active grants are cleared on `OnLastPageFromOriginClosed` and after a background timeout (`OnAllTabsInBackgroundTimerExpired`) [4]. The tracker that drives these events is attached through `tab_helpers.cc`, so it tracks tabs only [14]. *Inference, to verify:* grants obtained in a popup, side panel or offscreen document are not tracked as "pages". They would live in memory until browser restart, or until an extension page opened in a tab closes.
- **Offscreen documents** cannot be focused, can use only `chrome.runtime`, are limited to one per extension, and have no file-system reason [15]. They cannot show a picker. They could use an already granted handle and host `FileSystemObserver` (reason `WORKERS` or similar).
- **Write semantics.** `createWritable()` creates `<basename>.crswap` (or `.<n>.crswap`) next to the target. Changes "are **not** written to disk until the stream is closed" [1]. On close, the swap file is moved over the target after Safe Browsing checks [6][16]. Sync tools such as Syncthing or Nextcloud desktop, and KeePassXC's file watcher, will see a short-lived `.crswap` sibling and a replaced file.
- **External modification.** A `File` from `getFile()` "is only readable as long as the underlying file on disk hasn't changed" [1]. Reading a stale snapshot fails, so a fresh `getFile()` is needed each time. `FileSystemObserver` is `status: stable` in `runtime_enabled_features.json5`, and BCD lists it as Chrome 133 [2][8]. It reports `appeared`, `disappeared`, `modified`, `moved`, `unknown` and `errored`. Windows reports cross-directory moves as disappeared+appeared, and "unknown" events require polling [7]. Its IDL is `Exposed=(DedicatedWorker,SharedWorker,Window)`, with **no ServiceWorker** [8].
- **Interop with other KeePass apps.** KeePassXC saves through `QSaveFile` (temp file + rename), or through a `QTemporaryFile` rename fallback for cloud-sync folders [35]. Every save therefore replaces the file. Chromium handles resolve by path (the swap logic works on `url().path()` [6]), so a replaced file is still reachable through the stored handle.

### 2. Firefox

- **No File System Access pickers.** `showOpenFilePicker`, `showSaveFilePicker`, `queryPermission` and `requestPermission` are all `false` in BCD [2]. Mozilla's standards position is *negative* (issue closed via PR #545). Anne van Kesteren called the API "still harmful as we don't have a good way of informing the user about the risks", while singling out `getDirectory()` (OPFS) as fine [9].
- **OPFS is available** (`StorageManager.getDirectory`, `createWritable`, `FileSystemWritableFileStream` since Firefox 111) [2]. A 2023 bug about OPFS in an extension page turned out to be about `SharedArrayBuffer`, not OPFS, and was closed as a duplicate of 1673477 [17]. OPFS is private to the extension and gives no access to the user's file.
- **Write-back through `downloads.download()`.** Per MDN, `filename` is "a file path relative to the default downloads directory … Absolute paths, empty paths, path components that start and/or end with a dot (.), and paths containing back-references (`../`) will cause an error" [11]. `conflictAction: "overwrite"` is supported, but `"prompt"` is not supported in Firefox [2][11b]. `saveAs: true` shows a file chooser. If `saveAs` is omitted, the user's "Always ask you where to save files" preference decides [11]. In practice the Extension can overwrite a file silently only inside Downloads/. Anywhere else, the user goes through a Save As dialog on every save.
- **Picker from the popup.** Opening a file picker from a browserAction popup closes the popup. Bugzilla 1292701 ("Autoclose popups shouldn't close when they open a modal dialog (e.g., file picker)") and 1378527 are both **NEW** as of 2026 [12]. The import UI must therefore live in a tab, the options page or a `windows.create` popup window.
- **Host permissions** (relevant to WebDAV): see §4.

### 3. Safari

- No FSA pickers. `createWritable` arrived in Safari 26 but is OPFS-only [2]. WebKit's position on the File System Access API is *oppose* ("concerns: security") [10]. There is no `downloads` API for extensions [2].
- A Safari web extension always ships inside a macOS/iOS app and "consists of three parts … A macOS or iOS app … JavaScript code … A native app extension". Background scripts and extension pages (but not content scripts) can call `browser.runtime.sendNativeMessage`, which goes only to the containing app's native extension. Data is shared with the app through app groups [13]. Persistent read/write access to a user-chosen file would therefore be native code using security-scoped bookmarks (`withSecurityScope` gives "read/write access to a file-system resource" in sandboxed apps) [18]. That is effectively a built-in Companion.

### 4. WebDAV: fetching from extension contexts

- **Chrome.** "A script executing in an extension service worker or foreground tab can talk to remote servers outside of its origin, as long as the extension requests host permissions." Content scripts "are also subject to the same origin policy" [19]. For hosts only known at runtime, include `"https://*/*"` in `optional_host_permissions` and call `permissions.request()` "from inside a user gesture". `permissions.onAdded` and `permissions.onRemoved` report changes [19b].
- **Firefox.** Host permissions give "XMLHttpRequest and fetch access to those origins without cross-origin restrictions, but not for requests from content scripts" [19c]. From Firefox 127, MV3 host permissions are shown and granted at install, and "users can grant or revoke any host permission on an ad-hoc basis", so the Extension must check and re-request them [19d]. `permissions.request()` works only inside a user-action handler [19e].
- **Safari.** The user grants per-site access "for a single use, for the day, or for all websites", and can later switch any site to Ask/Allow/Deny [19f]. *Unverified:* whether a day-scoped grant also gates background `fetch` to the WebDAV host.
- **No browser auth dialogs from the background.** Fetch only prompts on 401 when credentials are included and the request's "traversable for user prompts is a traversable navigable" [33]. Service-worker requests therefore never show a dialog and just get the 401.

### 5. WebDAV: authentication and credential storage

- **Basic.** Set `Authorization: Basic …` yourself, as KeeWeb does with `btoa(user:password)` [36]. Using `credentials: "omit"` keeps the browser's cookies for that host off the request. This matters for Nextcloud: if a logged-in session cookie is present on a non-GET request that is not DAV-authenticated, `requiresCSRFCheck()` returns true and the request fails with `401 CSRF check not passed` [24].
- **Digest.** The browser will not do Digest for a background fetch (no prompt, see above), so the Extension would have to implement it. WebCrypto `digest()` supports only SHA-1/256/384/512, not MD5 [37]. Apache `mod_auth_digest` supports only `MD5` (and a broken `MD5-sess`) and recommends Basic over TLS instead [31]. Nextcloud's DAV auth is Basic or session.
- **Nextcloud app passwords.** Login Flow v2: `POST /index.php/login/v2` returns a poll token valid for 20 minutes, and the poll result returns `server`, `loginName` and `appPassword`. The app password is then used for Basic auth on WebDAV and can be revoked by the client with `DELETE /ocs/v2.php/core/apppassword` [23]. Users with 2FA or external auth need app passwords [20]. Koofr likewise requires an app-specific password [32].
- **Where a credential can live in an extension.** `chrome.storage.session` is in memory, "cleared if the extension is disabled, reloaded, updated, and when the browser restarts", holds 10 MB, and by default is not exposed to content scripts. `chrome.storage.local` persists and holds 10 MB, or more with `unlimitedStorage` [38]. The docs describe no at-rest encryption for either. A persisted WebDAV password needs app-level encryption, for example under a key derived from the Database credentials. That ties offline unlock to the Database password, which is a decision for #13/#14.

### 6. WebDAV: conflict detection and atomic writes

- **Protocol.** RFC 4918 §8.6: ETags "are necessary along with locks to avoid the lost-update problem". Strong ETags are preferred, and weak ETags "cannot be used in If-Match headers". A server "SHOULD NOT change the ETag (or the Last-Modified time) for a resource that has an unchanged body". The meaning of an ETag returned on PUT is "not clearly defined" [39]. A failed `If-Match` yields 412 [40].
- **MOVE is not atomic replacement by spec.** RFC 4918 §9.9.3 says that with `Overwrite: T`, "prior to performing the move, the server MUST perform a DELETE with 'Depth: infinity' on the destination" [39]. A conditional header on MOVE applies to the source. Only a tagged `If: <dest> (["etag"])` list (§10.4) can condition the destination, and x/net/webdav does not evaluate ETag conditions there [30]. "Temp + MOVE" therefore adds no atomicity on servers whose PUT is already atomic (Nextcloud, Apache, nginx), and gives no conflict protection anywhere.
- **Per-server behaviour** is in the summary table [21][22][25][26][27][28][29][30]. Practical consequence: before relying on `If-Match`, a client can probe a server, for example with a PUT to a scratch resource carrying `If-Match: "nonexistent"` and expecting 412. Without 412 support the remaining guard is compare-then-write, which leaves a race window.
- **ETag semantics differ.** Nextcloud returns its file-cache etag (`'"' . $this->info->getEtag() . '"'`), which is an opaque version id, not a content hash [22]. rclone's default is ModTime+size [30]. Nextcloud also exposes `oc:checksums` and accepts `OC-Checksum` and `X-OC-MTime` on upload [20].

## Prior art

| Client | Built-in WebDAV | Change detection | Write | Conflict handling |
|---|---|---|---|---|
| **KeeWeb** | Yes, XHR [36] | `rev` = `Last-Modified` response header (an error if missing). An optional "stat reload" mode uses the first 10 hex characters of the content SHA-256 [36] | `HEAD` and compare rev → `PUT` to `.<name>.<timestamp>` → `HEAD` and compare again → `MOVE` with `Overwrite: T` → stat. A "put" option writes directly [36] | On `revConflict`: load the remote file, `mergeOrUpdate`, save again [41]. Keeps an encrypted local copy in `Storage.cache` for offline open [41] |
| **Strongbox** | Yes, DAVKit [42] | PROPFIND `modificationDate`. Pulls only if it differs within an epsilon from `lastSyncRemoteModDate` [42][43] | Unconditional `PUT` to the file href, then PROPFIND for the new mod date [42] | `ConflictResolutionStrategy`: Ask / AutoMerge / ForcePushLocal / ForcePullRemote [44]. Keeps a local "working cache" copy [43] |
| **KeePassXC** | No. Maintainers point to "remote database support using standard external tools", added in 2.8.0 [45] | Local: `QFileSystemWatcher` plus periodic checksum, with polling forced on NFS [46] | Remote: a user-defined download command writes to a temp file, the result is merged, and an upload command sends the merged file [47]. Local: `QSaveFile` atomic save [35] | Merge |
| **KeePassDX** | No, by design. "KeePassDX is a file editor and not a file manager", so WebDAV is left to SAF document providers [48] | Snapshot of URI, exists, `lastModification` and `size` [49] | Through SAF | Reload/overwrite prompt, plus a KDBX merger (`MergeDatabaseRunnable`, `DatabaseKDBXMerger`) [50] |

None of the four uses `If-Match`/412. They all rely on compare-then-write plus a KDBX merge.

## Open risks / unknowns

1. **Chrome extension permission lifecycle is inferred from source, not observed.** This covers the popup/side-panel auto-grant on a restored handle, grant lifetime when no tab is involved, and whether a service worker sees a grant made in a popup. The auto-grant is recent (M143) and is security-sensitive, so it could be narrowed. A prototype on stable Chrome is needed before #13/#14 rely on it.
2. **Chrome re-prompt cadence after a restart** for extension origins. By default there are no extended grants [4]. Whether the restore prompt ("Allow on every visit") is offered to `chrome-extension://` at all is unknown.
3. **`.crswap` and replace-on-close** may interact badly with Syncthing/Dropbox-style sync and with concurrent KeePassXC saves. There is no cross-application lock.
4. **Firefox local write-back** works without a dialog only inside Downloads/. Download-history noise, AV/quarantine marking and overwrite reliability were not examined.
5. **Safari** needs native code for any in-place file access. Whether the native app extension can resolve a security-scoped bookmark created by the containing app (through app groups) is untested.
6. **Closed-source WebDAV servers** (Synology, Koofr, Yandex Disk) have unknown `If-Match`, ETag-stability and PUT-atomicity behaviour. Reverse proxies can also add ETags without enforcing `If-Match`.
7. **Safari per-site "for the day" grants** might break background sync to a WebDAV host.
8. **ETag stability**: Nextcloud etags are cache ids. Some servers may change the ETag without a body change or emit weak ETags, which would cause spurious merges (harmless but costly).

## Sources

- [1] Chrome for Developers, "The File System Access API" — https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- [1b] Chrome for Developers, "Persistent permissions for the File System Access API" — https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api
- [2] MDN browser-compat-data 8.1.4 (2026-10-01): `api.Window.showOpenFilePicker`, `api.FileSystemHandle.*`, `api.FileSystemFileHandle.createWritable`, `api.StorageManager.getDirectory`, `api.FileSystemObserver`, `webextensions.api.downloads.*` — https://github.com/mdn/browser-compat-data
- [3] WICG File System Access spec source (`index.bs`: `requestPermission`, transient activation, `Exposed=(Window,Worker)`) — https://github.com/WICG/file-system-access/blob/main/index.bs
- [4] Chromium `chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc` (`PermissionGrantImpl::RequestPermission`, `OriginHasExtendedPermission`, `OnLastPageFromOriginClosed`, `CleanupPermissions`) — https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc
- [5] Chromium commit ecb83649 "file_system_access: Auto-grant permission for extensions without request manager" (Bug 449897860) — https://github.com/chromium/chromium/commit/ecb83649e5828abe2bd9bf486274946ff9427cd1 , https://chromium-review.googlesource.com/c/chromium/src/+/7025212
- [6] Chromium `content/browser/file_system_access/file_system_access_file_handle_impl.cc` (`.crswap` swap file) — https://source.chromium.org/chromium/chromium/src/+/main:content/browser/file_system_access/file_system_access_file_handle_impl.cc
- [7] Chrome for Developers, "The File System Observer API" — https://developer.chrome.com/blog/file-system-observer
- [8] Blink IDL `file_system_observer.idl`, `file_system_handle.idl`, and `runtime_enabled_features.json5` (`FileSystemObserver: stable`) — https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/file_system_access/
- [9] Mozilla standards-positions #154 (File System Access, `position: negative`) — https://github.com/mozilla/standards-positions/issues/154
- [10] WebKit standards-positions #28 (`position: oppose`, `concerns: security`) — https://github.com/WebKit/standards-positions/issues/28
- [11] MDN `downloads.download()` — https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download ; [11b] `downloads.FilenameConflictAction` — https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/FilenameConflictAction
- [12] Bugzilla 1292701 — https://bugzilla.mozilla.org/show_bug.cgi?id=1292701 ; 1378527 — https://bugzilla.mozilla.org/show_bug.cgi?id=1378527 (dupes 1384684, 1658694)
- [13] Apple, "Messaging between the app and JavaScript in a Safari web extension" — https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension
- [14] Chromium `chrome/browser/permissions/one_time_permissions_tracker_helper.cc`, attached from `chrome/browser/ui/tab_helpers.cc` — https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/permissions/one_time_permissions_tracker_helper.cc
- [15] Chrome Extensions `chrome.offscreen` reference — https://developer.chrome.com/docs/extensions/reference/api/offscreen
- [16] Chromium commit 32d4f02a "[FSA] Run after-write checks after popup teardown" — https://github.com/chromium/chromium/commit/32d4f02a00166ac091d15f76341db0a4c2142fad
- [17] Bugzilla 1823260 (OPFS in extension, resolved as a duplicate of 1673477, SharedArrayBuffer) — https://bugzilla.mozilla.org/show_bug.cgi?id=1823260
- [18] Apple, `NSURL.BookmarkCreationOptions.withSecurityScope` — https://developer.apple.com/documentation/foundation/nsurl/bookmarkcreationoptions/withsecurityscope
- [19] Chrome Extensions, "Cross-origin network requests" — https://developer.chrome.com/docs/extensions/develop/concepts/network-requests ; [19b] `chrome.permissions` — https://developer.chrome.com/docs/extensions/reference/api/permissions ; [19c] MDN `host_permissions` — https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions ; [19d] Firefox Extension Workshop, MV3 migration guide — https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/ ; [19e] MDN `permissions.request()` — https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/permissions/request ; [19f] Apple, "Managing Safari web extension permissions" — https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions
- [20] Nextcloud developer manual, WebDAV basics — https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html
- [21] sabre/dav `lib/DAV/Server.php` (`checkPreconditions`, called from `invokeMethod`) — https://github.com/sabre-io/dav/blob/master/lib/DAV/Server.php
- [22] Nextcloud `apps/dav/lib/Connector/Sabre/File.php` (`put()`: part file and rename, quoted etag) — https://github.com/nextcloud/server/blob/master/apps/dav/lib/Connector/Sabre/File.php
- [23] Nextcloud developer manual, Login Flow — https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html
- [24] Nextcloud `apps/dav/lib/Connector/Sabre/Auth.php` (`requiresCSRFCheck`, "CSRF check not passed.") — https://github.com/nextcloud/server/blob/master/apps/dav/lib/Connector/Sabre/Auth.php
- [25] owncloud/reva `internal/http/services/owncloud/ocdav/put.go` — https://github.com/owncloud/reva/blob/main/internal/http/services/owncloud/ocdav/put.go
- [26] Apache httpd `modules/dav/fs/repos.c` (`DAV_FS_TMP_PREFIX ".davfs.tmp"`, rename "atomically after writes", `dav_fs_getetag`) — https://github.com/apache/httpd/blob/trunk/modules/dav/fs/repos.c
- [27] Apache httpd `modules/dav/main/util.c` (`dav_meets_conditions`) — https://github.com/apache/httpd/blob/trunk/modules/dav/main/util.c
- [28] nginx `src/http/modules/ngx_http_dav_module.c` — https://github.com/nginx/nginx/blob/master/src/http/modules/ngx_http_dav_module.c
- [29] nginx `src/http/modules/ngx_http_not_modified_filter_module.c` — https://github.com/nginx/nginx/blob/master/src/http/modules/ngx_http_not_modified_filter_module.c
- [30] rclone `cmd/serve/webdav/webdav.go` (`--etag-hash`; uses `golang.org/x/net/webdav`) — https://github.com/rclone/rclone/blob/master/cmd/serve/webdav/webdav.go ; golang.org/x/net `webdav/webdav.go` (`handlePut` TODO, `O_TRUNC`, `confirmLocks`) and `webdav/lock.go` (`TODO: support Condition.Not and Condition.ETag`) — https://github.com/golang/net/tree/master/webdav
- [31] Apache httpd `mod_auth_digest` docs — https://httpd.apache.org/docs/2.4/mod/mod_auth_digest.html
- [32] Koofr help, "Which password do I need to use when setting up a connection via WebDAV?" — https://koofr.eu/help/koofr_with_webdav/which-password-to-use-when-connecting-via-webdav/
- [33] WHATWG Fetch, HTTP-network-or-cache fetch (401 handling) — https://fetch.spec.whatwg.org/#http-network-or-cache-fetch
- [34] Chromium Dash milestone branch positions (M142 = 1522585, M143 = 1536371) — https://chromiumdash.appspot.com/fetch_milestones?only_branched=true
- [35] KeePassXC `src/core/Database.cpp` (`QSaveFile` atomic save, `QTemporaryFile` fallback) — https://github.com/keepassxreboot/keepassxc/blob/develop/src/core/Database.cpp
- [36] KeeWeb `app/scripts/storage/impl/storage-webdav.js` — https://github.com/keeweb/keeweb/blob/master/app/scripts/storage/impl/storage-webdav.js
- [37] MDN `SubtleCrypto.digest()` — https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
- [38] Chrome Extensions `chrome.storage` — https://developer.chrome.com/docs/extensions/reference/api/storage
- [39] RFC 4918 (WebDAV), §8.6, §9.9.3, §10.4 — https://www.rfc-editor.org/rfc/rfc4918
- [40] RFC 9110 (HTTP Semantics), §13.1.1 If-Match — https://www.rfc-editor.org/rfc/rfc9110#section-13.1.1
- [41] KeeWeb `app/scripts/models/app-model.js` (`loadFromStorageAndMerge`, `Storage.cache`) — https://github.com/keeweb/keeweb/blob/master/app/scripts/models/app-model.js
- [42] Strongbox `StrongBox/WebDAVStorageProvider.m` — https://github.com/strongbox-password-safe/Strongbox/blob/master/StrongBox/WebDAVStorageProvider.m
- [43] Strongbox `model/Sync/SyncAndMergeSequenceManager.m` — https://github.com/strongbox-password-safe/Strongbox/blob/master/model/Sync/SyncAndMergeSequenceManager.m
- [44] Strongbox `model/Sync/ConflictResolutionStrategy.h` — https://github.com/strongbox-password-safe/Strongbox/blob/master/model/Sync/ConflictResolutionStrategy.h
- [45] KeePassXC issue #10897, maintainer comment (2024-06-14) — https://github.com/keepassxreboot/keepassxc/issues/10897
- [46] KeePassXC `src/core/FileWatcher.cpp` — https://github.com/keepassxreboot/keepassxc/blob/develop/src/core/FileWatcher.cpp
- [47] KeePassXC `src/gui/remote/RemoteHandler.cpp` — https://github.com/keepassxreboot/keepassxc/blob/develop/src/gui/remote/RemoteHandler.cpp
- [48] KeePassDX issue #118, maintainer comments (2020-02-13 and later) — https://github.com/Kunzisoft/KeePassDX/issues/118
- [49] KeePassDX `app/src/main/java/com/kunzisoft/keepass/model/SnapFileDatabaseInfo.kt` — https://github.com/Kunzisoft/KeePassDX/blob/master/app/src/main/java/com/kunzisoft/keepass/model/SnapFileDatabaseInfo.kt
- [50] KeePassDX `MergeDatabaseRunnable.kt` and `database/merge/DatabaseKDBXMerger.kt` — https://github.com/Kunzisoft/KeePassDX/tree/master/database/src/main/java/com/kunzisoft/keepass/database/merge
