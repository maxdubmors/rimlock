# Research: the Companion seam (native messaging and YubiKey)

Ticket: [#7](https://github.com/maxdubmors/rimlock/issues/7). Researched 2026-10-06 against primary sources: browser vendor docs, specs, and source code pinned to the commits listed at the end.

## Question

What constraints and prior art shape the seam between the Extension and the future Companion?

- Native messaging in Chrome, Firefox and Safari: manifest registration, message size limits, lifecycle, install UX.
- The KeePassXC-Browser protocol: message set, key exchange, association model. Could KeePassXC act as a Companion for a Database the Extension also opens itself?
- How YubiKey HMAC-SHA1 challenge-response is folded into the KDBX composite key (KeePassXC, Strongbox, KeePassDX). Is there any way to reach it from an extension (WebHID / WebUSB restrictions on the YubiKey OTP interface)?
- How the Bitwarden and 1Password desktop apps pair with their extensions (biometric unlock over native messaging), as prior art.

This document collects facts only. It does not design the seam.

## Summary

- **Chrome and Firefox native messaging share one model**: a JSON host manifest registered per user or system-wide, a stdio host process started by the browser, and JSON messages with a 32-bit length prefix. Host→extension messages are capped at **1 MB** in both browsers. The host process belongs to the browser: it lives as long as the port and gets killed when the port closes. `nativeMessaging` can be an *optional* permission in both browsers. Firefox for Android has no native messaging. Confined Firefox (snap/flatpak) reaches hosts only through an XDG portal that shows a one-time prompt.
- **Safari is different**: an extension can only message the native app extension of its own containing app. Safari ignores the application ID argument, so a Safari Companion has to be, or be bundled with, the app that ships the Safari Extension.
- **Every desktop prior-art product uses the same topology**: a small proxy binary is the registered host, and it relays to the long-running app over a local socket or named pipe. KeePassXC (`keepassxc-proxy`), Bitwarden (`desktop_proxy`) and Strongbox (`afproxy`) all do this.
- **The KeePassXC-Browser protocol is a credential-query API** over a NaCl `box` channel (`get-logins`, `set-login`, `get-totp`, passkeys, `request-autotype`, lock signals). It never exposes key material or raw Database bytes, and it never exposes the YubiKey response. Association needs a user dialog in KeePassXC. The association key is stored **inside the Database** as `KPXC_BROWSER_<id>` in Meta CustomData, and the Database "hash" is SHA-256 of the root Group UUID. KeePassXC's own host manifest whitelists only the keepassxc-browser extension IDs, so a custom ID works only in debug builds.
- **YubiKey challenge-response is the same in KeePassXC, KeePassDX and Strongbox (KDBX 4)**: the challenge is the KDF seed/salt from the header, PKCS#7-padded to 64 bytes. The 20-byte HMAC-SHA1 response is SHA-256-hashed and appended as the last component of the composite key. KeePassXC re-randomises the KDF seed on every save, so every save needs a fresh challenge. Strongbox works around this with an opt-in cache of challenge/response pairs.
- **An extension cannot reach the YubiKey**: Chromium's WebHID and WebUSB blocklists list every Yubico VID/PID by device. WebHID also blocks the keyboard usage the OTP interface uses, and WebUSB protects the HID and smart-card interface classes. Firefox and Safari implement neither API (both vendors oppose them). Software HMAC from a user-supplied secret is the only browser-only route (Strongbox's "virtual YubiKey").
- **Bitwarden pairs as follows**: an RSA-2048 key from the extension, then an AES-256-CBC-HMAC session secret from the desktop app, then encrypted messages carrying a timestamp (10 s validity) and a userId check. Biometric unlock returns the vault user key to the extension. On Safari, Bitwarden skips the desktop app and does LocalAuthentication plus Keychain inside the Safari app extension. 1Password documents that its app checks the browser's code signature (macOS/Windows) or package-manager install (Linux), and that "account information and encryption keys" cross the connection.

## Findings

### 1. Native messaging: Chrome, Firefox, Safari

#### Manifest and registration

- **Chrome host manifest fields**: `name` (lowercase alphanumerics, `_` and `.` only), `description`, `path` (must be absolute on Linux/macOS, may be relative on Windows), `type` (`"stdio"`), and `allowed_origins`, a list of `chrome-extension://<id>/` origins with no wildcards ([Chrome: Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)).
- **Chrome locations** ([same page](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)):
  - Windows: registry key `HKLM` or `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\<name>`, whose default value is the manifest path. The 32-bit registry view is queried first.
  - macOS: `/Library/Google/Chrome/NativeMessagingHosts/` (system) or `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` (user).
  - Linux: `/etc/opt/chrome/native-messaging-hosts/` (system) or `~/.config/google-chrome/NativeMessagingHosts/` (user).
  - Chromium uses its own paths.
- **Firefox host manifest** uses `allowed_extensions` (add-on IDs) instead of `allowed_origins`. The extension must set an explicit `browser_specific_settings.gecko.id` ([MDN: Native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)). Firefox locations ([MDN: Native manifests](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests)):
  - macOS: `/Library/Application Support/Mozilla/NativeMessagingHosts/` or `~/Library/Application Support/Mozilla/NativeMessagingHosts/`.
  - Linux: `/usr/lib/mozilla/native-messaging-hosts/` (or `lib64`) or `~/.mozilla/native-messaging-hosts/`.
  - Windows: `HKLM` or `HKCU\SOFTWARE\Mozilla\NativeMessagingHosts\<name>`, with the 32-bit view checked first since Firefox 64.
- **So one Companion needs at least two manifests** (Chrome-style and Firefox-style) plus one location per Chromium-derived browser. Bitwarden's desktop app writes the manifests to every known browser directory (user-level on macOS/Linux, `HKCU` keys on Windows) and adds Flatpak/Snap-specific copies of its proxy binary ([`native-messaging.main.ts`](https://github.com/bitwarden/clients/blob/a6ffbe65a3b63b22c1435cd2b4813c703480c863/apps/desktop/src/main/native-messaging.main.ts)). Strongbox, a sandboxed Mac App Store app, can write the manifests only because it declares `com.apple.security.temporary-exception.files.home-relative-path.read-write` for each browser's `NativeMessagingHosts` directory ([`StrongBox.entitlements`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/macbox/StrongBox.entitlements)).
- **Enterprise policy can block user-level hosts**: `NativeMessagingUserLevelHosts=false` restricts Chrome to system-level hosts ([policy definition](https://chromium.googlesource.com/chromium/src/+/main/components/policy/resources/templates/policy_definitions/NativeMessaging/NativeMessagingUserLevelHosts.yaml)). `NativeMessagingBlocklist` and `NativeMessagingAllowlist` live in the same policy group.

#### Wire format and size limits

- **Wire format**: UTF-8 JSON preceded by a 32-bit length in native byte order. Both browsers use it ([Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)).
- **Size limits**:

  | Direction | Chrome | Firefox |
  |---|---|---|
  | Host → extension | 1 MB | 1 MB |
  | Extension → host | 64 MiB | 4 GB |

  Sources: [Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging). KeePassXC caps its own replies at `NATIVEMSG_MAX_LENGTH = 1 MiB / 1.6 = 655 360` ([`BrowserShared.h`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserShared.h)). Anything larger, such as a whole `.kdbx` file sent by the Companion, would have to be chunked.
- **Windows binary mode**: hosts must switch stdio to `O_BINARY`, or line-ending translation corrupts the stream ([Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)). `keepassxc-proxy` does exactly this ([`NativeMessagingProxy.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/proxy/NativeMessagingProxy.cpp)).

#### Lifecycle

- **Two calling modes**: `runtime.connectNative()` starts the host, which runs until the port is disconnected. `runtime.sendNativeMessage()` starts a new host process for every message, and only the first reply counts ([Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)).
- **Termination**: Firefox sends SIGTERM and then SIGKILL on Unix. On Windows it puts the host in a Job object and kills the job, and only `CREATE_BREAKAWAY_FROM_JOB` children survive ([MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)). A Companion that must outlive the browser connection (an SSH agent, for example) therefore cannot *be* the host process. That is why the products in the Prior art section use a relay.
- **Arguments**: Chrome passes the caller origin as the first argument, plus `--parent-window=<HWND>` on Windows (0 when the call comes from a service worker). Firefox passes the manifest path and then the extension ID ([Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)). These arguments are the only caller identity the host receives from the browser.
- **MV3 service worker**: since Chrome 105, an open `connectNative()` port keeps the extension service worker alive. Normally the worker dies after 30 s idle or after one 5-minute request ([Chrome: SW lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
- **Contexts**: native messaging cannot be used from content scripts in Chrome, Firefox or Safari. Messages must be relayed through the background ([Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging), [Apple](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)).

#### Permission and install UX

- **Optional permission**: `nativeMessaging` may be declared optional. Firefox has allowed this since 87 ([bug 1630415](https://bugzilla.mozilla.org/show_bug.cgi?id=1630415), [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)). Chrome's list of permissions that *cannot* be optional does not include it ([chrome.permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)). Bitwarden's MV3 manifest ships it under `optional_permissions` ([`manifest.v3.json`](https://github.com/bitwarden/clients/blob/a6ffbe65a3b63b22c1435cd2b4813c703480c863/apps/browser/src/manifest.v3.json)) and checks `permissionsGranted(["nativeMessaging"])` before connecting ([`nativeMessaging.background.ts`](https://github.com/bitwarden/clients/blob/a6ffbe65a3b63b22c1435cd2b4813c703480c863/apps/browser/src/background/nativeMessaging.background.ts)). The user-facing prompt reads "communicate with cooperating native applications" ([Bitwarden help](https://bitwarden.com/help/biometrics/)).
- **Confined Linux Firefox (snap/flatpak)**: Firefox cannot read the manifests itself and delegates to the WebExtensions XDG portal or the newer native-messaging proxy. The user sees "a one-time prompt for each extension requesting to launch a given native application" ([Firefox source docs: native messaging portal](https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/native-messaging-portal-design.html)).
  - The portal "isn't widely available yet in a release of the XDG desktop portals project". Ubuntu has shipped it since 22.04, and the proxy replacement ships in Ubuntu 26.04 ([same doc](https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/native-messaging-portal-design.html)).
  - KeePassXC accommodates sandboxes by putting its socket in `$XDG_RUNTIME_DIR/app/org.keepassxc.KeePassXC/` so that "sandbox containers" can mount it ([`BrowserShared.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserShared.cpp)).
- **Firefox for Android**: `connectNative` and `sendNativeMessage` are unsupported, except for privileged GeckoView extensions ([MDN browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/runtime.json)).

#### Safari

- **Architecture**: a Safari web extension has three parts, each sandboxed: the containing app, the JS extension, and a native app extension that "mediates between" the two. Data is shared through app groups ([Apple: Messaging between the app and JavaScript in a Safari web extension](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)).
- **JS → native**: `browser.runtime.sendNativeMessage(id, msg)` goes to the native app extension's `beginRequest(with:)`. "Safari ignores the `application.id` parameter and only sends the message to the containing app's native app extension" ([same page](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)). Safari 17+ includes a profile identifier.
- **App → JS**: macOS only. The extension opens `browser.runtime.connectNative(...)`, and the app pushes messages with `SFSafariApplication.dispatchMessage(withName:toExtensionWithIdentifier:userInfo:)`. "You can't send messages from a containing iOS app to your web extension's JavaScript scripts" ([same page](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)).
- **Distribution**: Safari web extensions are "implemented as a macOS, visionOS, or iOS app extension" and distributed with an app, so they need Apple Developer Program membership ([Apple: Safari web extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions); [packaging via App Store Connect](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect)). There is no free-standing host-manifest mechanism.

### 2. The KeePassXC-Browser protocol

#### Channel and keys

([`keepassxc-protocol.md`](https://github.com/keepassxreboot/keepassxc-browser/blob/8b0b2c4347126f4983f59ea7dd6ca2a2a667cf48/keepassxc-protocol.md))

- **Encryption**: TweetNaCl `box` (Curve25519/XSalsa20-Poly1305). The extension creates an ephemeral *client key* each launch and sends its public key in plaintext with `change-public-keys`. KeePassXC answers with an ephemeral *host key*.
- **Message envelope**: messages are `{action, message: base64(ciphertext), nonce (24 B), clientID (24 B), requestID?}`. The response nonce is the request nonce incremented.
- **Identification key**: a third, permanent key pair created by the extension at `associate`. KeePassXC stores its public part, and later requests prove association by sending `{id, key}`. The doc itself notes that "only the public key part is ever used which might be a tiny flaw in the protocol since that part is also stored in the database".

#### Message set

- **Requests**: `associate`, `test-associate`, `change-public-keys`, `get-databasehash`, `get-logins`, `set-login`, `generate-password`, `get-totp` (2.6.1+), `get-database-groups`, `create-new-group`, `lock-database`, `request-autotype` (2.7.0+, performs *Global* Auto-Type), `passkeys-get` and `passkeys-register` (2.7.7+).
- **Signals from KeePassXC**: `database-locked` and `database-unlocked`.
- **What is absent**: nothing returns key material, the composite key, a challenge-response result or the Database file.

#### Association model

([KeePassXC `BrowserService.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp))

- **User consent**: on `associate`, KeePassXC opens a modal titled "New key association request". The user names the connection, and only then is access saved.
- **Storage**: the key is written to the **Database's** `Meta/CustomData` as `KPXC_BROWSER_<name>`, with a `_CREATED_<name>` timestamp ([`CustomData.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/CustomData.cpp)). Associations travel with the `.kdbx` file and are per Database, not per KeePassXC install.
- **Per-Entry state**: allowed and denied hosts and realm are stored in Entry CustomData under `KeePassXC-Browser Settings` ([`BrowserEntryConfig.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserEntryConfig.cpp)). Group options such as `BrowserHideEntry` and `BrowserOmitWww` are stored in Group CustomData.
- **Database hash**: `get-databasehash` returns `SHA-256(hex root-group UUID)` (the legacy variant also mixes in the recycle-bin UUID) ([`BrowserService::getDatabaseHash`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserService.cpp)). Requests target the *currently selected* unlocked Database unless a root-group UUID picks another open one (`BrowserService::getDatabase`).

#### Transport and who may connect

- **Proxy**: the registered host is `keepassxc-proxy`, which copies length-prefixed stdin to KeePassXC's local socket and back without inspecting the caller origin argument ([`NativeMessagingProxy.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/proxy/NativeMessagingProxy.cpp)).
- **Socket location**:
  - Linux: `$XDG_RUNTIME_DIR/app/org.keepassxc.KeePassXC/org.keepassxc.KeePassXC.BrowserServer` (with a legacy symlink).
  - Windows: named pipe `org.keepassxc.KeePassXC.BrowserServer_<USERNAME>`.
  - macOS: the Darwin user temp dir.
  - Source: [`BrowserShared.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/BrowserShared.cpp).
- **Hard-coded allowlist**: the manifests KeePassXC installs allow only `keepassxc-browser@keepassxc.org` (Firefox) and `chrome-extension://pdffhmdngciaglkoonimfcmckehcpafo/` and `chrome-extension://oboonakemofpalcgghocfoadofidjkkk/` (Chromium). A user-set custom extension ID is added **only in `QT_DEBUG` builds** ([`NativeMessageInstaller.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/browser/NativeMessageInstaller.cpp)).

#### Could KeePassXC be a Companion for a Database the Extension also opens?

These are facts, not a recommendation:

- **KeePassXC must hold the Database unlocked itself.** The protocol only serves Databases unlocked in its GUI and offers no way to hand over a key or unlock remotely.
- **Reaching KeePassXC needs a separate host registration.** A third-party Extension ID is not in KeePassXC's manifest. rimlock would need its own host manifest pointing at `keepassxc-proxy`, or the user would need to edit KeePassXC's manifest. The proxy itself does not check the origin, and KeePassXC still gates access through the association dialog.
- **It brings none of the Companion capabilities.** Only `request-autotype` maps to a listed Companion capability (Auto-Type outside the browser). The protocol has no messages for SSH agent, YubiKey, file access or quick unlock. KeePassXC does have its own SSH agent and YubiKey support, but neither is reachable through this protocol.
- **Shared-file consequences**:
  - Both programs would write the same `.kdbx`. KeePassXC watches the file and, on external change, reloads and **merges** its in-memory copy into the new file, either automatically (`AutoReloadOnChange`) or after asking ([`DatabaseWidget::reloadDatabaseFile`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/gui/DatabaseWidget.cpp)).
  - rimlock would see `KPXC_BROWSER_*` and `KeePassXC-Browser Settings` CustomData and would have to round-trip it intact.
  - rimlock can compute the same Database hash from the root-group UUID, so it could tell that both programs have the same Database open.

### 3. YubiKey HMAC-SHA1 challenge-response and the KDBX composite key

#### The device side

- **Algorithm**: HMAC-SHA1 with a 20-byte secret per OTP slot (1 or 2), a challenge of up to 64 bytes, and a 20-byte deterministic response. Touch is optional per slot ([Yubico YESDK: Challenge-response](https://docs.yubico.com/yesdk/users-manual/application-otp/challenge-response.html); [YubiKey 5 technical manual, OTP](https://docs.yubico.com/hardware/yubikey/yk-tech-manual/yk5-apps-otp.html)).
- **Transport**: over USB, challenge-response runs on the OTP application's HID keyboard interface using **feature reports**. Yubico's SDK states that it "will only work when a YubiKey is physically plugged into a host over USB or Lightning… cannot be communicated wirelessly with NFC" ([YESDK](https://docs.yubico.com/yesdk/users-manual/application-otp/challenge-response.html)). KeePassXC nonetheless also reaches the HMAC applet over **PC/SC (CCID, including NFC readers)** by selecting AID `A0 00 00 05 27 20 01`, and it also tries the Nitrokey 3 and Fidesmo AIDs ([`YubiKeyInterfacePCSC.h`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/keys/drivers/YubiKeyInterfacePCSC.h)). Its USB path uses `ykpers` `yk_challenge_response` with `SLOT_CHAL_HMAC1/2` ([`YubiKeyInterfaceUSB.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/keys/drivers/YubiKeyInterfaceUSB.cpp)).

#### KeePassXC (reference implementation)

- **Challenge padding**: the challenge is PKCS#7-padded to 64 bytes, and the response is truncated to 20 bytes ([`YubiKeyInterfaceUSB.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/keys/drivers/YubiKeyInterfaceUSB.cpp)).
- **KDBX 4**: the challenge is the **KDF seed**, meaning the AES-KDF seed or the Argon2 salt from the header's KDF parameters. The composite raw key is `SHA-256( H(password) ‖ keyfile-key ‖ SHA-256(response₁ ‖ …) )`, and that value goes into the KDF ([`CompositeKey::rawKey`, `CompositeKey::transform`, `CompositeKey::challenge`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/keys/CompositeKey.cpp)).
- **KDBX 3.1**: the challenge is the header **master seed**, and the response enters *after* the KDF: `finalKey = SHA-256(masterSeed ‖ SHA-256(response) ‖ transformedKey)` ([`Kdbx3Reader.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/Kdbx3Reader.cpp), [`Database::challengeMasterSeed`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Database.cpp)). When a KDBX 3 AES-KDF Database is upgraded to KDBX 4, the writer forces a re-transform "because challenge-response hashing has changed in KDBX 4" ([`KeePass2Writer.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KeePass2Writer.cpp)).
- **Every save needs the device**: the KDBX 4 writer calls `setKey(key, false, /*updateTransformSalt=*/true)`, which randomises the KDF seed, so each save issues a new challenge and needs the YubiKey present and possibly touched ([`Kdbx4Writer.cpp`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/Kdbx4Writer.cpp), [`Database::setKey`](https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Database.cpp)).

#### KeePassDX (Android)

- **Same composition**: the challenge is the KDBX `transformSeed` (the KDF seed), and the response is hashed with `HashManager.sha256` before joining the composite key ([`MasterCredential.kt`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/element/MasterCredential.kt), [`DatabaseKDBX.kt`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/element/database/DatabaseKDBX.kt)).
- **The hardware talk lives in another app**: KeePassDX sends the intent `android.yubikey.intent.action.CHALLENGE_RESPONSE` to a separate driver app ([`HardwareKeyLauncherViewModel.kt`](https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/app/src/main/java/com/kunzisoft/keepass/credentialprovider/viewmodel/HardwareKeyLauncherViewModel.kt)). That is a Companion-like split on Android.

#### Strongbox (iOS/macOS)

- **Same composition**: the challenge is `kdf.transformSeed`, and the factors are `[SHA-256(password)?, keyFileDigest?, SHA-256(response)]` ([`Kdbx4Serialization.m`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/Kdbx4Serialization.m)).
- **Opt-in response cache**: Strongbox can cache `(challenge, response)` pairs per Database (`hardwareKeyCRCaching`, KDBX 4 only). It answers from the cache when it can and caches the pair after a successful save ([`Model.m`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/StrongBox/Model.m)).
- **"Virtual YubiKey"**: Strongbox can store the slot's HMAC secret in the Keychain and compute the same padded HMAC-SHA1 in software ([`VirtualYubiKey.m`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/VirtualYubiKey.m)).
- **Conclusion**: KeePassXC, KeePassDX and Strongbox compose the key the same way and can open each other's challenge-response Databases.

#### Can an extension reach the YubiKey?

- **Chromium WebHID**:
  - The static blocklist blocks the whole FIDO usage page (`0xF1D0`) *and* lists **Yubico devices by VID/PID**, including `1050:0401`–`0407` (the YubiKey 4/5 OTP/FIDO/CCID combinations) and `1050:0010`–`0410` across generations. Each listed device is blocked whatever its interface ([`hid_blocklist.cc`](https://chromium.googlesource.com/chromium/src/+/main/services/device/public/cpp/hid/hid_blocklist.cc)).
  - The WebHID spec blocklist also blocks the Generic Desktop **Keyboard** usage (`0x0001/0x0006`), which is what the OTP interface presents ([WICG/webhid `blocklist.txt`](https://github.com/WICG/webhid/blob/main/blocklist.txt)).
  - Extension service workers may use `navigator.hid` but cannot call `requestDevice()` ([WebHID in extension SW explainer](https://github.com/WICG/webhid/blob/main/WEBHID_IN_EXTENSION_SERVICE_WORKERS_EXPLAINER.md)). That does not matter here because the device is blocked.
- **Chromium WebUSB**:
  - The USB blocklist lists the same Yubico PIDs, citing crbug 818807 ([WICG/webusb `blocklist.txt`](https://github.com/WICG/webusb/blob/main/blocklist.txt)).
  - Separately, `claimInterface()` rejects with `SecurityError` for **protected interface classes**, which include HID `0x03` and Smart Card `0x0B` ([WebUSB spec source](https://github.com/WICG/webusb/blob/3dcc3c2d53/index.bs)). Both of the YubiKey's CR paths (OTP HID and CCID) are therefore closed twice over.
  - The escape hatch, the `usb-unrestricted` policy feature, "MUST only be enabled for Isolated Web Apps" ([same source](https://github.com/WICG/webusb/blob/3dcc3c2d53/index.bs)). It does not cover extensions.
- **Firefox and Safari**: neither implements WebHID or WebUSB. Mozilla's position is *negative* on both ([WebHID #459](https://github.com/mozilla/standards-positions/issues/459), [WebUSB #100](https://github.com/mozilla/standards-positions/issues/100)), and WebKit's is *oppose* on both ([WebHID #510](https://github.com/WebKit/standards-positions/issues/510), [WebUSB #68](https://github.com/WebKit/standards-positions/issues/68)).
- **Conclusion**: no supported browser API gives the Extension challenge-response. The only routes are a native process (the Companion) or a software HMAC using a secret the user supplies, as Strongbox's Virtual YubiKey does.

### 4. Prior art: Bitwarden and 1Password desktop pairing

#### Bitwarden (open source)

- **Topology**:
  - The host name is `com.8bit.bitwarden`. Its manifest path points to a separate `desktop_proxy` binary, and the Electron app runs a `NativeIpcServer` that the proxy connects to ([`native-messaging.main.ts`](https://github.com/bitwarden/clients/blob/a6ffbe65a3b63b22c1435cd2b4813c703480c863/apps/desktop/src/main/native-messaging.main.ts)).
  - Allowed origins are hard-coded store IDs for Chrome, Chrome beta, Edge and Opera, plus the Firefox ID `{446900e4-…}`.
  - The desktop app writes manifests for many browsers. On Linux it copies or hard-links the proxy into each browser's host directory, to cover every Flatpak/Snap combination of app and browser.
- **Handshake**:
  - The extension generates an RSA-2048 key pair and sends `setupEncryption {publicKey, userId}` in plaintext ([`nativeMessaging.background.ts`](https://github.com/bitwarden/clients/blob/a6ffbe65a3b63b22c1435cd2b4813c703480c863/apps/browser/src/background/nativeMessaging.background.ts)).
  - The desktop app rejects a userId that is not logged in (`wrongUserId`). It then generates an AES-256-CBC-HMAC session secret, RSA-encrypts it to the extension and stores it per `appId` ([`biometric-message-handler.service.ts`](https://github.com/bitwarden/clients/blob/a6ffbe65a3b63b22c1435cd2b4813c703480c863/apps/desktop/src/services/biometric-message-handler.service.ts)). A new public key for a known `appId` invalidates the old trust.
  - Later messages are encrypted, carry a `timestamp` that must be within **10 s**, and are correlated by `messageId`. An undecryptable message triggers `invalidateEncryption`.
- **What crosses the channel**: `UnlockWithBiometricsForUser` makes the desktop app run the OS biometric prompt and return `userKeyB64`, the vault user key, to the extension.
- **User steps**: set up biometrics in the desktop app, optionally enable "Require verification for browser integration", then enable "Unlock with biometrics" in the extension and accept the native-messaging permission. Chrome and Edge may also need "Allow access to file URLs". Windows requires the non-Store desktop build ([Bitwarden help: biometrics](https://bitwarden.com/help/biometrics/)).
- **Safari is a different path**: the Safari app extension handles `unlockWithBiometricsForUser` itself. It calls `LAContext.evaluateAccessControl` (biometryAny) and then reads the key from the Keychain (`Bitwarden_biometric` service) ([`SafariWebExtensionHandler.swift`](https://github.com/bitwarden/clients/blob/a6ffbe65a3b63b22c1435cd2b4813c703480c863/apps/browser/src/safari/safari/SafariWebExtensionHandler.swift)). No desktop-app IPC is involved.

#### 1Password (closed source; vendor docs only)

- **What crosses the connection**: "Account information and encryption keys are transferred using this connection to allow the 1Password app and browser extension to share your vaults and lock state". The connection also enables biometric unlock of the extension ([1Password: app and extension connection security](https://support.1password.com/1password-browser-connection-security/)).
- **Caller verification**: on macOS and Windows the app "verifies the browser's code signature". On Linux it "checks to confirm that the browser appears to be installed by a package manager". Browsers outside a built-in list can be added manually on Mac and Linux ([same page](https://support.1password.com/1password-browser-connection-security/)).

#### Strongbox (KDBX, open source)

- **Topology**: the Mac app installs `com.markmcguill.strongbox` manifests that point at a bundled `afproxy` binary. The Firefox ID is `strongbox@phoebecode.com` ([`NativeMessagingManifestInstallHelper.swift`](https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/macbox/browser-autofill/NativeMessagingManifestInstallHelper.swift)).
- **Relevance**: it is the closest prior art for "a KDBX desktop app that owns the YubiKey and serves a browser extension".

## Prior art

| Product | Host binary | Transport to app | Channel crypto | Pairing / trust | What the extension receives |
|---|---|---|---|---|---|
| KeePassXC + keepassxc-browser | `keepassxc-proxy` | Unix socket / named pipe | NaCl box, ephemeral keys per session | User-named association dialog; key stored in the Database's CustomData | Credentials, TOTP, passkey assertions, lock signals; never keys |
| Bitwarden | `desktop_proxy` | `NativeIpcServer` (local IPC) | RSA-2048 wrap of AES-256-CBC-HMAC session key; 10 s timestamp window | Same logged-in userId; optional desktop-side verification | Vault user key after biometric prompt |
| Bitwarden on Safari | none (app extension) | `sendNativeMessage` → `SafariWebExtensionHandler` | n/a (in-process) | Keychain + LocalAuthentication | Vault user key |
| 1Password | not documented | not documented | not documented | Browser code-signature / package-manager check | Account info and encryption keys; shared lock state |
| Strongbox | `afproxy` | not inspected | not inspected | not inspected | AutoFill credentials |
| KeePassDX (Android) | n/a | Android intent to a driver app | n/a | n/a | Challenge-response result for KDBX unlock |

## Open risks / unknowns

- **No independent check of the 1 MB limit**: the host→extension cap comes from browser docs. Neither the Chrome nor the Firefox source was checked for the exact byte value or for behaviour at the edge.
- **Chromium in Flatpak/Snap**: Bitwarden's code shows the problem space, but no primary Chromium documentation was found for native messaging in confined Chromium builds.
- **Fixed-length HMAC slots**: KeePassXC always pads challenges to 64 bytes, and its code comments question whether 64-byte fixed-length configurations work. How slots configured *without* variable-length input interoperate was not verified.
- **KeePass 2.x compatibility**: the KeeChallenge plugin's repository could not be retrieved, so it was not checked whether KeePass 2.x's challenge-response plugins match the KeePassXC scheme. Treat Databases from that ecosystem as possibly incompatible.
- **NFC and Lightning**: Yubico's SDK says challenge-response does not work over NFC, while KeePassXC's PC/SC driver ships NFC-specific handling. The exact hardware/firmware matrix was not established.
- **Chromium's HID blocklist override**: Chromium has a developer-only override flag (`disable-hid-blocklist`). It is not a shippable route, and its exact effect on keyboard-usage reports was not verified from Chromium source.
- **Extension-to-socket bypass**: the KeePassXC socket accepts any local process of the same user, and `keepassxc-proxy` does not check the caller origin. The protocol's only gate is the association key. The security implications for a third-party Extension or Companion talking to KeePassXC were not assessed.
- **Exclusive device access**: if KeePassXC, a rimlock Companion and other tools all try to challenge the same YubiKey, they can conflict over device access. This was not tested.
- **Safari Companion placement**: whether a Safari Companion could also serve Chrome and Firefox from the same containing app depends on Mac App Store sandbox rules. Strongbox's temporary-exception entitlement is one data point, not a guarantee of App Review acceptance.
- **Unlocked-state dependence**: what the Companion should hand back (credentials, the composite key, the CR response, or an unlock token) depends on the unlocked-state decision and is out of scope here.

## Sources pinned

- keepassxreboot/keepassxc @ `9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd` (2026-09-22)
- keepassxreboot/keepassxc-browser @ `8b0b2c4347126f4983f59ea7dd6ca2a2a667cf48` (develop)
- Kunzisoft/KeePassDX @ `2db52c5fd016aad50352ba60383f6aefd29100c4` (2026-09-25)
- strongbox-password-safe/Strongbox @ `c70fc7b021d9dfa2b18a6d7e13406e717dd5251a` (2026-07-17)
- bitwarden/clients @ `a6ffbe65a3b63b22c1435cd2b4813c703480c863` (2026-10-06)
- Chromium `services/device/public/cpp/hid/hid_blocklist.cc` at `main`, read 2026-10-06
- WICG/webusb @ `3dcc3c2d53`; WICG/webhid `blocklist.txt` at `main`, read 2026-10-06
