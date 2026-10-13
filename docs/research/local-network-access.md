# Chrome Local Network Access and extension fetches to private-IP WebDAV

Research for [#35](https://github.com/maxdubmors/rimlock/issues/35). Feeds ADR-0008 (WebDAV Source) and ADR-0013 (permissions). Researched 2026-10-13.

## Answer

**Local Network Access (LNA) does not affect rimlock's WebDAV fetches, in Chrome or in Firefox.** A `fetch` from the extension service worker, the offscreen document or an extension page (popup, options tab) to a server on `192.168.x.x`, `10.x`, `172.16/12`, `.local` or loopback goes through without a prompt. No manifest entry, extension permission or prompt is needed. **ADR-0013's frozen required set needs no change.** Chrome has no `local-network-access` extension permission; Firefox has none either.

Both browsers exempt extension contexts the same way: they put the extension origin in the most private address space. LNA only checks a request that goes to an address space more private than its initiator, so a fetch from an extension origin is never checked. **The exemption comes from the `chrome-extension://` / `moz-extension://` origin, not from host permissions.** Host permissions still matter for CORS, as before (ADR-0013).

Two things here are real, but neither is LNA:

- **Self-signed certificates on a LAN server fail in Chrome** with `net::ERR_CERT_AUTHORITY_INVALID`, and an extension cannot override that. The user has to make the certificate trusted (see "Self-signed certificates" below).
- **Content scripts and web-accessible iframes are not exempt.** Content scripts follow the page's LNA behaviour. ADR-0008 already puts all WebDAV traffic in the background, so this costs nothing as long as it stays there.

## What LNA is, and where it stands (October 2026)

**Chrome**

- LNA gates requests from a public site to a local or loopback address, and from a local site to loopback, behind a user permission prompt. It is limited to secure contexts. It supersedes the earlier Private Network Access (PNA) preflight design. Source: the chromestatus entry ["Local network access restrictions"](https://chromestatus.com/feature/5152728072060928), updated 2026-07-15.
- **Timeline** (chromestatus):
  - 138: opt-in flag ([Chrome blog](https://developer.chrome.com/blog/local-network-access)).
  - 142: shipped on desktop and Android. The [intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY/m/hk8YuZDWHgAJ) originally targeted 141.
  - 145: the single `local-network-access` permission split into `local-network` and `loopback-network`.
  - 146: enterprise policies `LocalNetworkAccessIpAddressSpaceOverrides` and `LocalNetworkAccessPermissionsPolicyDefaultEnabled`.
  - 147: WebSocket and WebTransport added.
  - 156: the `LocalNetworkAccessRestrictionsTemporaryOptOut` enterprise policy is removed.
- **Current state:** fully on by default. In Chromium `main` ([78ed3b7](https://github.com/chromium/chromium/tree/78ed3b7f37599d8a7dba1aa8375a22a23740a31d)) these flags are `ENABLED_BY_DEFAULT`:
  - `kLocalNetworkAccessChecks` ([services/network/public/cpp/features.cc#L223](https://github.com/chromium/chromium/blob/78ed3b7f37599d8a7dba1aa8375a22a23740a31d/services/network/public/cpp/features.cc#L223))
  - `kLocalNetworkAccessForWorkers` ([content/common/features.cc#L437](https://github.com/chromium/chromium/blob/78ed3b7f37599d8a7dba1aa8375a22a23740a31d/content/common/features.cc#L437))
  - WebSockets and WebTransport

  Current stable (155.0.8059.39, the Chrome for Testing build used below) enforces LNA on web pages; see "Verified" below.

**Firefox**

- Firefox ships its own LNA, with `local-network` and loopback permission keys (chromestatus marks Firefox "Shipped/Shipping").
- On the `release` branch (Firefox 158.0.1), `network.lna.enabled` and `network.lna.blocking` both default to `true` ([StaticPrefList.yaml on release](https://github.com/mozilla-firefox/firefox/blob/release/modules/libpref/init/StaticPrefList.yaml)).
- Per Mozilla's support article ([SUMO](https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox), as summarised by search; the page itself is bot-walled), it started under ETP Strict in 149 and rolled out gradually to everyone from 151.

## Why extension contexts are exempt: Chrome (read from source)

1. **The extension origin is classified as loopback.** Documents and workers with a non-HTTP URL have no remote IP. In that case `CalculateIPAddressSpace` falls back to `IPAddressSpaceForSpecialScheme`, which asks the embedder ([content/browser/renderer_host/local_network_access_util.cc#L279-L303](https://github.com/chromium/chromium/blob/78ed3b7f37599d8a7dba1aa8375a22a23740a31d/content/browser/renderer_host/local_network_access_util.cc#L279-L303)). Chrome's embedder answers `kLoopback` for the extension scheme ([chrome/browser/chrome_content_browser_client.cc#L2285-L2299](https://github.com/chromium/chromium/blob/78ed3b7f37599d8a7dba1aa8375a22a23740a31d/chrome/browser/chrome_content_browser_client.cc#L2285-L2299)):

   ```cpp
   if (url.SchemeIs(extensions::kExtensionScheme)) {
     return network::mojom::IPAddressSpace::kLoopback;
   }
   ```

2. **The extension service worker gets the same classification.** It is registered from the browser with no frame. `GetPoliciesForRegistration` therefore builds ad-hoc policies whose address space comes from `CalculateIPAddressSpace(scope)`, and the scope is `chrome-extension://<id>/` ([content/browser/service_worker/service_worker_context_wrapper.cc#L249-L271](https://github.com/chromium/chromium/blob/78ed3b7f37599d8a7dba1aa8375a22a23740a31d/content/browser/service_worker/service_worker_context_wrapper.cc#L249-L271)). The same block carries `TODO(crbug.com/435246545): Add browser test to test extensions and LNA`, so this path has no dedicated Chromium test yet.
3. **The network service only checks requests that go to a less public space.** It compares the target's address space with the client's using `IsLessPublicAddressSpaceLNA`, which also merges `local` and `loopback`. If the target is not less public, it returns `kAllowedNoLessPublic` before any policy or permission is consulted ([services/network/local_network_access_checker.cc#L152-L164](https://github.com/chromium/chromium/blob/78ed3b7f37599d8a7dba1aa8375a22a23740a31d/services/network/local_network_access_checker.cc#L152-L164)). A loopback client can never send a less-public request.
4. **No extension permission exists for this.** Neither `extensions/common/api/_permission_features.json` nor `chrome/common/extensions/api/_permission_features.json` contains anything about local or loopback networks or LNA.

None of this depends on host permissions, and the empirical test below confirms it.

## Why extension contexts are exempt: Firefox (read from source and Bugzilla; not run)

- **Firefox checks only two transitions.** In `nsHttpTransaction`, LNA applies when `IsLocalOrPrivateNetworkAccess(parent, target)` is true, which means Public → Private, or Public/Private → Local (loopback) ([netwerk/base/nsNetUtil.cpp#L4376-L4407](https://github.com/mozilla-firefox/firefox/blob/d8b0cd3f8ed35b6c7094e274d180ed3ef5e7e637/netwerk/base/nsNetUtil.cpp#L4376-L4407), [netwerk/protocol/http/nsHttpTransaction.cpp#L4311](https://github.com/mozilla-firefox/firefox/blob/d8b0cd3f8ed35b6c7094e274d180ed3ef5e7e637/netwerk/protocol/http/nsHttpTransaction.cpp#L4311)). An `Unknown` or `Local` parent never qualifies.
- **The parent's address space is only ever set from an HTTP response's peer address.** `nsHttpChannel` sets the browsing context's address space that way. `moz-extension:` documents are not loaded over HTTP, so their space stays `Unknown`. Loads with no browsing context and no policy container default to `Local` ([netwerk/base/LoadInfo.cpp#L2122](https://github.com/mozilla-firefox/firefox/blob/d8b0cd3f8ed35b6c7094e274d180ed3ef5e7e637/netwerk/base/LoadInfo.cpp#L2122)).
- **Mozilla engineers state the exemption.** In [bug 2032778](https://bugzilla.mozilla.org/show_bug.cgi?id=2032778) (2026-04), Rob Wu, Mozilla's WebExtensions engineer, writes "Extensions should be exempt from LNA prompts … This works already." The networking owner explains that "extensions page have ip address space set to local".
- **Known open edge cases**, neither of which affects rimlock's background:
  - [Bug 2032778](https://bugzilla.mozilla.org/show_bug.cgi?id=2032778): an extension *tab* that starts a navigation and aborts it gets a public address space and then prompts.
  - [Bug 2023758](https://bugzilla.mozilla.org/show_bug.cgi?id=2023758): an extension page loaded in an iframe on a web page (a `web_accessible_resources` iframe, like rimlock's Inline menu) is LNA-checked against the top-level site.
  - In the same thread, Mozilla confirms that content scripts follow the page's LNA behaviour.
- **No WebExtension permission exists for LNA.** `toolkit/components/extensions/schemas/manifest.json` has nothing about local or loopback networks.

## Verified (Chrome for Testing 155.0.8059.39, Linux, headless)

**Setup:**

- **Test servers:** Python serving `http://192.168.31.194:8080/dav` and `https://192.168.31.194:8443/dav` (a self-signed certificate for the IP) on the machine's real Wi-Fi address (RFC 1918, not loopback).
- **Probe extension:** an unpacked MV3 extension with `host_permissions: ["http://*/*","https://*/*"]` and `offscreen`. It fetches both URLs from the service worker, from an offscreen document (`BLOBS`) and from an extension page in a tab, then reports each result to a loopback logger.
- **Control:** a web page on `http://127.0.0.1:8001`, forced into the public address space with `--ip-address-space-overrides=127.0.0.1:8001=public`, that fetches the same URLs.

| Run | Service worker | Offscreen document | Extension page | Public web page (control) |
|---|---|---|---|---|
| 1. Defaults, HTTP target | 200, request reached the server | 200 | 200 | **blocked** (`Failed to fetch`, request never reached the server) |
| 1. Defaults, HTTPS self-signed | fails, `net_error -202` (`ERR_CERT_AUTHORITY_INVALID`) | same | same | blocked |
| 2. `--ignore-certificate-errors`, HTTP and HTTPS | 200 / 200 | 200 / 200 | 200 / 200 | **blocked** |
| 3. Control, LNA disabled (`--disable-features=LocalNetworkAccessChecks`) | n/a | n/a | n/a | both reached the server |
| 4. Extension **without** host permissions | request reached the server (Origin `chrome-extension://…`), then failed CORS | same | same | n/a |

What the runs show:

- **LNA is active and enforced in this build:** the control is blocked, and unblocked only when LNA is disabled.
- **Extension contexts bypass LNA** for both HTTP and HTTPS targets on a private IP.
- **The bypass is not tied to host permissions** (run 4).
- **The only HTTPS failure was the untrusted certificate.**

**Not verified empirically:**

- `.local` hostnames (no mDNS responder was set up). By the source above, the target's address space is irrelevant when the client is loopback.
- A headful browser's prompt UI.
- Firefox (not installed on the test machine; findings are from source and Bugzilla only).

## HTTP vs HTTPS, and self-signed certificates

- **HTTP:** LNA does not block an extension fetching `http://192.168.x.x` (Chrome verified, run 1). The LNA "secure context only" rule and its mixed-content relaxation apply to web pages. In Chrome, rimlock refusing plain HTTP is therefore purely its own threat-model choice (ADR-0002), not a browser constraint, and rimlock has to enforce it in its own code. In Firefox, the default MV3 extension-page CSP is `script-src 'self'; upgrade-insecure-requests;` ([all.js#L3158](https://github.com/mozilla-firefox/firefox/blob/d8b0cd3f8ed35b6c7094e274d180ed3ef5e7e637/modules/libpref/init/all.js#L3158)), so an `http://` fetch from the event page is upgraded to `https://`. That agrees with the HTTPS-only rule, but it means HTTP behaves differently in the two browsers. Validate the scheme at Connect in both, and do not rely on either browser to do it.
- **Self-signed HTTPS on the LAN:** this is the real user-facing obstacle, and it is unrelated to LNA. In Chrome, a background or offscreen `fetch` fails with a generic `TypeError: Failed to fetch`. The extension cannot see the underlying `ERR_CERT_AUTHORITY_INVALID` (only the browser log shows `net_error -202`) and has no API to override it. The certificate (or its CA) has to be trusted by the OS or browser trust store. Firefox stores user certificate exceptions per host:port.
  - **Not verified:** whether a Chrome interstitial "Proceed" decision or a Firefox exception made in a tab carries over to extension fetches.
  - **Consequence for the UI:** the Connect flow should treat a network-level failure on an `https://` LAN URL as "possibly an untrusted certificate" and point to help text, because the error itself does not say so.

## Consequences for the ADRs

- **ADR-0013:** no change. The frozen required set is enough, and no LNA permission exists to add. Note one fact only: host permissions are what make CORS pass, not what avoid LNA.
- **ADR-0008:** no change to the decision. It gains a reason to keep every WebDAV request in the background (service worker / offscreen document in Chrome, event page in Firefox) and never in a content script or a web-accessible iframe, because those are LNA-checked against the page. An optional follow-up for the help pages / Connect UX: a LAN Nextcloud with a self-signed certificate needs that certificate trusted in the OS or browser, and a generic `Failed to fetch` on an `https://` LAN URL usually means exactly that.
- **Residual risk:**
  - Chrome's exemption has no dedicated browser test yet (crbug 435246545), so a regression would go uncaught by Chromium's own tests. The classification is explicit embedder code, and Mozilla describes the same exemption as intended, so a regression would most likely be treated as a bug. If it ever happens, the symptom is a `Failed to fetch` on Sync; ADR-0008's offline Local copy already tolerates that.
  - Firefox's open bugs show edge cases for extension *tabs* and *iframes* only.
