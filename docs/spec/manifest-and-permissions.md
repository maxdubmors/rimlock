# Manifest and permissions

Principle: [ADR-0013](../adr/0013-permissions-frozen-required-set.md). The required set ships complete in the first release and **never grows**: Chrome disables an Extension whose update adds a required permission with a warning, and Firefox never grants host access added in an update. A permission is required only if every user needs it from the first run; anything else with a warning is optional and requested inside the click that needs it.

## Manifest (MV3 in both browsers)

| Key | Value |
|---|---|
| `manifest_version` | 3 in both browsers; WXT must be told explicitly for Firefox ([ADR-0004](../adr/0004-mv3-on-every-browser.md)) |
| `host_permissions` | `http://*/*`, `https://*/*` (not `<all_urls>`); the only install warning |
| `permissions` | `storage`, `unlimitedStorage`, `idle`, `alarms`, `scripting`, `activeTab`, and in Chrome `offscreen`; none has a warning |
| `optional_permissions` | `clipboardRead`, `clipboardWrite`, `privacy`, and in Firefox `downloads` |
| `optional_host_permissions` | none |
| `commands` | `_execute_action`, `fill`, `lock` ([`generator-and-copy.md`](generator-and-copy.md)) |
| `content_scripts` | `matches` = the host pattern, `all_frames: true`; no `match_about_blank` or `match_origin_as_fallback` |
| `web_accessible_resources` | only the iframe HTML of the Inline menu and the Save prompt (no scripts, no WASM), for the host pattern, `use_dynamic_url: true` in Chrome; URLs always through `runtime.getURL()` |
| `content_security_policy.extension_pages` | the default plus `'wasm-unsafe-eval'`; never `unsafe-eval` |
| `options_ui` | `options.html`, `open_in_tab: true` |
| `background` | Chrome: service worker; Firefox: event page (non-persistent) |
| Firefox `browser_specific_settings.gecko` | a fixed `id` ([ADR-0011](../adr/0011-companion-is-a-capability-provider.md)); `strict_min_version` = the current supported Firefox ESR; `data_collection_permissions: ["none"]` |
| Chrome `key` | development builds only, so the unpacked Extension ID is fixed |
| Chrome `minimum_chrome_version` | the highest floor among the APIs used (`offscreen`, `storage.*.setAccessLevel`, `action.openPopup`, `FileSystemObserver`, `idle`, …), computed in M0 and recorded with the build |

**Never declared:** `tabs`, `webRequest`, `webNavigation`, `background`, `notifications`, `contextMenus`, `externally_connectable`, and, in the MVP, `nativeMessaging` (it comes later as optional).

## Optional permissions

| Permission | Requested in | If refused |
|---|---|---|
| `clipboardRead` + `clipboardWrite` | the first Copy ([`generator-and-copy.md`](generator-and-copy.md)) | Copy works; values are not cleared; Settings offer **Enable clipboard clearing** |
| `privacy` | **Turn off the browser's password saving** (first run, Settings) | the browser keeps offering to save passwords |
| `downloads` (Firefox) | the first **Export…** | Export… is unavailable; the reason is shown |

Only `downloads.download({saveAs: true})` guarantees a Save As dialog in Firefox; an `<a download>` link follows the "Always ask" pref and could silently drop the file into Downloads.

## The offscreen document (Chrome)

- One document, created on first need (unlocking a local-file Database, or the first clipboard clear), with reasons `[BLOBS, CLIPBOARD]`. None of Chrome's reasons covers file handles, and reasons cannot change after creation.
- It lives until the browser closes, because closing it drops the file grant.
- `justification`: "Keeps the user-granted handle to the KeePass file open so changes can be written back, and clears copied passwords from the clipboard."
- It never holds the Database. Firefox has no offscreen API; clipboard clearing runs in the event page there.

## Withheld site access

- Site access can be withdrawn after install, globally or per site, in both browsers (Firefox has no install-time opt-out).
- The popup checks access with `permissions.contains` for the tab origin **and** a ping to the content script, because Chrome's per-site "block all extensions" may not show up in `contains` ([`verification.md`](verification.md) V11).
- Without access: the popup shows the Matches through `activeTab` and Fills through a one-off `scripting` injection (a click, so [`security.md`](security.md) holds). No Inline menu or Save prompt there. The banner "rimlock can't see this site" offers **Allow on this site** / **Allow on all sites**, requested in the click.

## Re-injection

- Chrome does not run declared content scripts in tabs that were open before an install or update. So `runtime.onInstalled` (install and update) injects into every `http(s)` tab and frame through `scripting.executeScript`. Firefox does this itself.
- Both browsers inject again after `permissions.onAdded` ([`verification.md`](verification.md) V13 decides whether Firefox needs it).
- Content scripts are idempotent, and an orphaned one detects the lost connection and removes its UI.

## WebDAV origins

Covered by `host_permissions`. **Connect** still calls `permissions.request({origins: [server]})` inside the click. Every Sync checks `permissions.contains` and shows **Grant** when access is missing. Removing a WebDAV Database never calls `permissions.remove` (Chrome refuses to remove a required origin).

## Store disclosures

The listing text, the per-permission justifications and the reviewer notes are in [`docs/store/listing.md`](../store/listing.md). The privacy policy is [`PRIVACY.md`](../../PRIVACY.md). In short:

- Chrome Web Store single purpose: "Fill and manage passwords from the user's own KeePass database." Data usage: Authentication information and Website content, with the three certifications.
- AMO: `data_collection_permissions: ["none"]` with a reviewer note on the only network traffic. If review disagrees, switching to a declared category is a manifest update.

Decision detail: [Decide the permissions strategy](https://github.com/maxdubmors/rimlock/issues/25). Facts: [Toolchain and store policies](https://github.com/maxdubmors/rimlock/issues/8).
