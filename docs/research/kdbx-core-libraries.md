# KDBX core libraries: keepass-rs vs kdbxweb (and the rest)

Research for [#2](https://github.com/maxdubmors/rimlock/issues/2). Date: 2026-10-06. This doc compares the options and does not pick one. The choice belongs to #11.

## Question

Which library should be the KDBX core of the Extension? keepass-rs is the main hypothesis, and kdbxweb plus any other credible candidate are compared against it on six points:

1. Building to WASM and running in an MV3 extension (bundle size, `wasm-unsafe-eval`).
2. KDBX4 read-modify-write fidelity against what KeePassXC, Strongbox and KeePassDX write; KDBX3 read.
3. Argon2d/id and AES-KDF speed in WASM at typical parameters.
4. Merge support in the KeePassXC style.
5. Key file formats, composite keys, and hooks for YubiKey challenge-response.
6. Maturity: maintenance, tests, audits, and GPL-3.0 license compatibility.

Versions examined:

- keepass-rs `master` @ `d08c680` (2026-09-21), which equals crate `keepass` 0.15.0.
- kdbxweb `master` @ `7601e45` (2024-12-23). The latest npm release is 2.1.1 (2021-09-06).
- KeePassXC `develop` @ `9e0f57a` (2026-09-22), used as the reference implementation.
- KeePassXC CLI 2.7.12 for fixtures.

## Summary

| | keepass-rs (`keepass` crate) | kdbxweb |
|---|---|---|
| Language / delivery | Rust, compiled to `wasm32-unknown-unknown` | TypeScript/JS. Argon2 is not included, so you plug in a WASM implementation |
| Last release / last commit | 0.15.0, 2026-09-21 / same day | npm 2.1.1, **2021-09-06** / 2024-12-23 |
| Activity (last 12 months) | 64 commits, 2 active maintainers + about 10 contributors | No commits since 2024-12. PRs and issues sit unanswered |
| License | MIT, and every wasm dependency is MIT/Apache/BSD-style. GPL-3.0 compatible | MIT. Deps: `@xmldom/xmldom`, `fflate` |
| Bundle (measured) | 0.89 MB `.wasm` (open + save + merge), **≈280 KB gzip** | 135 KB min (36 KB gz) + hash-wasm argon2 29 KB (12 KB gz) + xmldom when there is no `DOMParser` |
| Needs `'wasm-unsafe-eval'` | Yes | Yes, in practice (Argon2 needs WASM to be fast) |
| KDBX3 read / write | Read yes / **write no** | Read yes / write yes |
| KDBX4 write | **Only as 4.1**: a 4.0 file has to be upgraded on save | 4.0 and 4.1 |
| Unknown XML elements | **Dropped** in Meta/Entry. **Opening fails** if one sits inside a `<Group>` | Dropped everywhere (KeePassXC drops them too) |
| Elements out of canonical order | **Opening fails** (e.g. non-contiguous `<String>`) | Fine |
| KeePassXC fixture round trip (measured) | No semantic loss (custom data, icons, tags, history, attachments, autotype, OTP, recycle bin all kept) | Kept, but writes 4.1 `LastModificationTime` as ISO text (spec says base64): open bug since 2023 |
| AES-KDF 1M rounds (measured, Node) | **~820 ms** (software AES in WASM) | **~36 ms** (WebCrypto) |
| Argon2d 64 MiB / t=10 / p=4 (measured) | ~720 ms | ~580 ms (hash-wasm) |
| Merge | Behind private `_merge` feature. Two-way, timestamp-based. **Attachments and custom icon ids dropped on update**, Meta not merged | `Kdbx.merge()` is public: entries, groups, deleted objects, binaries, meta. History merges as an OR-set CRDT |
| Key files | XML v1/v2, 32-byte binary, 64-hex, hashed. v2 hash **not checked** | Same formats, v2 hash checked |
| Challenge-response hook | Only via its own USB code (`challenge_response` feature), **doesn't compile for wasm**. No callback | `KdbxChallengeResponseFn` callback in `Credentials` |
| Security audit | None found | None found |
| Test coverage | 85.97% (Codecov, 2026-09-30); 81 integration tests pass locally | 97.8% (Coveralls, 2024-12-24) |

The other candidates are minor. The one serious alternative, KeePassXC's own C++ core, isn't packaged as a library (see [Other candidates](#other-candidates)).

## Findings

### 1. WASM build and the MV3 context

- **keepass-rs officially supports wasm32.** `Cargo.toml` has `wasm32-unknown-unknown`-only dependencies (`js-sys`, getrandom `wasm_js`, uuid `js`) [KR-Cargo]. The repo's `.cargo/config.toml` sets `getrandom_backend="wasm_js"` [KR-cargo-config]. CI runs `wasm-pack test --node` and `cargo check --target wasm32-unknown-unknown --no-default-features` [KR-CI]. There is a wasm regression test that opens an Argon2 KDBX4 file [KR-wasm-test]. CI only checks wasm **without** the `save_kdbx4` and `_merge` features.
- **Verified locally:** `cargo build --release --lib --target wasm32-unknown-unknown --features "save_kdbx4 _merge totp"` succeeds on rustc 1.98.1. A probe crate exposing open, save and merge through wasm-bindgen 0.2.129 (opt-level `s`, LTO, `panic=abort`) produces `probe_bg.wasm` = **890,290 bytes, 279,069 bytes gzip -9**. `wasm-opt -Oz` brings it to 786,291 bytes, but the gzip size doesn't shrink.
- **The `challenge_response` feature doesn't compile for wasm32.** Verified locally: the `nusb` WebUSB backend fails with unresolved `web_sys::Usb*` imports, and with `--cfg web_sys_unstable_apis` it then fails on the blocking `.wait()` API inside `challenge_response` 0.5.46.
- **kdbxweb** is plain JS (135 KB min, 36 KB gzip for `dist/kdbxweb.min.js` 2.1.1, measured). It does **not** ship Argon2: "you have to implement it manually and export to kdbxweb" [KW-README]. The README example uses a WASM implementation, so it still needs WASM. It also uses `globalThis.DOMParser`/`XMLSerializer` when present and otherwise falls back to `@xmldom/xmldom` [KW-xml-utils]. **MV3 service workers have no `DOMParser`**, so in a service worker kdbxweb would pull in xmldom.
- **The npm kdbxweb 2.1.1 carries a high-severity transitive advisory.** It depends on `@xmldom/xmldom ^0.7.4`. `npm audit` (run locally) reports GHSA-wh4c-j3r5-mjhp, GHSA-2v35-w6hq-6mfw and GHSA-f6ww-3ggp-fr8h. `master` bumped xmldom to `^0.8.10` but was never published (issues [#59](https://github.com/keeweb/kdbxweb/issues/59) and [#61](https://github.com/keeweb/kdbxweb/issues/61), unanswered).
- **CSP.** Chrome's default MV3 `extension_pages` policy is `script-src 'self'; object-src 'self';`, and "WebAssembly will be disabled". The minimum policy Chrome allows is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';` [Chrome-CSP]. Firefox MV3 likewise permits only `'none'`, `'self'` and `'wasm-unsafe-eval'` for scripts, and recommends declaring `'wasm-unsafe-eval'` for WebAssembly [MDN-CSP]. **Both candidates therefore need `'wasm-unsafe-eval'`**, keepass-rs for everything and kdbxweb for any fast Argon2. This is allowed and costs nothing in extra store policy.

### 2. KDBX4 read-modify-write fidelity, KDBX3

**Architecture.** Both libraries parse into a typed model and rebuild the XML from scratch on save. Neither keeps the original DOM.

- keepass-rs uses serde + quick-xml structs [KR-xml-meta] [KR-xml-entry]. serde ignores fields it doesn't know.
- kdbxweb has a `switch` per element with no default branch [KW-entry-read], and `buildXml()` creates a fresh document [KW-buildXml].
- KeePassXC does the same: `KdbxXmlReader` calls `skipCurrentElement()` on unknown tags [KX-xmlreader]. **Losing unknown XML on save is normal across the ecosystem.** The real compatibility bar is the set of elements the reference clients actually write.

**Empirical round trip (done locally).**

- Fixture A: written by KeePassXC CLI 2.7.12 with a group, an entry carrying an attachment and a history item, and a deleted entry in the Recycle Bin. KeePassXC saved it as KDBX 4.1 because of `PreviousParentGroup`.
- Fixture B: A plus data injected with pykeepass: Meta, Group and Entry `CustomData` (KeePassXC-browser-style and plugin-style keys), a custom icon with `Name`, entry tags, protected and plain custom strings, an `otp` field, an AutoType association, and unknown elements in Meta, Entry and Group.
- Each file went open → save → open through keepass-rs-in-WASM (Node 26) and through kdbxweb 2.1.1. The decrypted XML was compared with an order-insensitive normalizer.

| Observation | keepass-rs | kdbxweb |
|---|---|---|
| CustomData (Meta/Group/Entry), custom icon + name, tags, protected custom strings, OTP, attachment bytes, history, AutoType association, Recycle Bin, `PreviousParentGroup` | kept | kept |
| Unknown element in `<Meta>` / `<Entry>` | silently dropped | silently dropped |
| Unknown element in `<Group>` | **fails to open**: `unknown variant 'RimlockUnknownGroup', expected 'Group' or 'Entry'` | dropped |
| `<String>` elements not contiguous (pykeepass appends new Strings after `<Tags>`; KeePassXC opens this fine) | **fails to open**: `duplicate field 'String'` | fine |
| Entry with a custom icon | `IconID` not written (only `CustomIconUUID`) | both written |
| CustomData `LastModificationTime` (4.1) | base64 binary (correct) | **ISO text** (violates spec) |
| Default fields | adds `<QualityCheck>True</QualityCheck>`, omits empty elements, reorders Strings | rewrites `Generator` to `KdbxWeb`, joins tags with `", "` |
| KeePassXC 2.7.12 opens the result | yes | yes |

Why keepass-rs fails on the two open errors above:

- **Group failure.** `Group.children` is a serde `$value` catch-all typed as `enum GroupOrEntry { Group, Entry }` [KR-xml-group]. Any other child element becomes a hard error. This blocks opening files from a future KDBX version that adds group elements, and a lossy fix would just drop them.
- **Out-of-order failure.** quick-xml can only deserialize non-contiguous repeated elements into a `Vec` with its `overlapped-lists` feature, and keepass-rs enables only `serialize` [KR-Cargo] (quick-xml 0.42 `src/de/mod.rs`, section "Overlapped (Out-of-Order) Elements").

The kdbxweb ISO-date bug is [issue #49](https://github.com/keeweb/kdbxweb/issues/49), open since 2023-03, with fix PR [#62](https://github.com/keeweb/kdbxweb/pull/62) open and unmerged. The code is `XmlUtils.setDate(...)` without the binary flag in [KW-customdata] and [KW-meta-icons]. The PR notes current KeePassXC tolerates it, while KeePass 2.x rejected such files.

Other fidelity facts:

- **keepass-rs writes KDBX 4.1 only.** `dump_kdbx4` returns `UnsupportedVersion` unless `config.version == KDB4(1)` [KR-dump], and `Database::save` refuses KDB, KDBX2 and KDBX3 [KR-save]. A caller can set `db.config.version = KDB4(1)`, which is what the probe does. Saving a 4.0 or 3.1 file therefore **silently upgrades** it to 4.1. KeePassXC picks the lowest version that fits the features in use, so a plain database stays 4.0 [KX-writer]. Open upstream issue: [#373 "Support saving KDBX 4.0"](https://github.com/sseemayer/keepass-rs/issues/373). Clients older than KDBX 4.1 support (KeePass < 2.48, older Strongbox/KeePassDX) would stop opening the file. Not verified per client.
- **Entry string fields live in a `HashMap`** [KR-entry], so the write order is arbitrary. This has no semantic effect, because KeePass treats strings as a dictionary.
- **Writer bugs fixed recently.** keepass-rs fixed two writer bugs that made KeePassXC reject its files (nullable bools written empty, `DataTransferObfuscation` written as a bool) in April 2026 ([#312](https://github.com/sseemayer/keepass-rs/pull/312)). Regression tests run against a KeePassXC 2.7.12 KDBX 4.1 fixture [KR-kpxc-compat]. The test suite also runs `kpscript` cross-checks when the tool is installed [KR-cross-tool].
- **Attachment bug in history.** [keepass-rs #360](https://github.com/sseemayer/keepass-rs/issues/360) (open): deleting an attachment leaves dangling references in history entries and can panic.
- **KDBX3 and KDB.** keepass-rs reads KDB (KeePass 1), KDBX3 and KDBX4 [KR-README], and test fixtures cover KDBX3 with ChaCha20 [KR-tests]. kdbxweb reads and writes 3 and 4 (`saveV3`/`saveV4`) [KW-format], but its `CipherId` lists only AES and ChaCha20, **no Twofish** [KW-consts]. keepass-rs supports Twofish [KR-Cargo].
- **Native test suite.** `cargo test --release --features "save_kdbx4 _merge totp"`: all 14 integration suites pass (81 tests) plus unit tests. Run locally.

### 3. KDF performance in WASM

Measured in Node 26 (V8, the same engine as Chrome) on an Intel i7-1255U, as the median of 3 opens, so the time is dominated by the KDF. Test databases were generated with kdbxweb. "Native" means KeePassXC CLI 2.7.12, which runs multithreaded.

| KDF parameters | keepass-rs (WASM) | kdbxweb + hash-wasm | KeePassXC native |
|---|---|---|---|
| AES-KDF, 1,000,000 rounds (keepassxc-cli `db-create` default) | 819 ms | 36 ms | 27 ms |
| Argon2d, 64 MiB, t=10, p=4 | 718 ms | 582 ms | 221 ms |
| Argon2id, 64 MiB, t=10, p=4 | 609 ms | 469 ms | – |
| Argon2d, 256 MiB, t=4, p=4 | 1143 ms | 1154 ms | 334 ms |

- **What the parameters mean.** KeePassXC's Argon2 defaults are 64 MiB, a baseline of 10 rounds, and parallelism `min(idealThreadCount, 4)` [KX-argon2-h] [KX-argon2-cpp]. The rounds are then benchmarked to a target decryption time, and AES-KDF defaults to 1,000,000 rounds [KX-kdf-h]. Since KeePassXC tunes rounds to about 1 s of native multithreaded time, a database it tuned on a fast desktop will take roughly **3x longer to unlock in a single-threaded WASM extension**.
- **AES-KDF is keepass-rs's weak spot.** Without AES-NI in WASM, the `aes` crate is about 23x slower than kdbxweb's WebCrypto approach. kdbxweb emulates the ECB rounds with AES-CBC through WebCrypto [KW-aes-kdf]. A keepass-rs-based core could get the same speedup by computing AES-KDF in JS/WebCrypto, but keepass-rs exposes no KDF hook today. `crypt` is `pub(crate)` [KR-lib].
- **Argon2 is close.** keepass-rs uses `rust-argon2` 3.0 [KR-Cargo], which runs single-threaded in wasm. Its wasm test notes that multithreaded Argon2 used to panic there [KR-wasm-test]. hash-wasm is about 20% faster at 64 MiB and equal at 256 MiB. Neither uses threads, which would need `SharedArrayBuffer` and cross-origin isolation.

### 4. Merge

- **keepass-rs.** `Database::merge(&mut self, other)` exists, but only behind the `_merge` feature. The leading underscore marks it as unstable/private [KR-Cargo] [KR-merge].
  - It is a two-way merge on `LastModificationTime`, with history merging and handling of deleted objects and relocations. There are about 30 unit tests [KR-merge].
  - It only merges icons and groups (entries are merged inside the group pass), so **Meta is not merged** ([#243](https://github.com/sseemayer/keepass-rs/issues/243), open).
  - **Attachments and custom icon ids are silently dropped when an entry is updated from the other side**: `// TODO: attachments and custom_icons_id` [KR-merge-todo], [#336](https://github.com/sseemayer/keepass-rs/issues/336), open. This is data loss in a sync scenario.
  - The maintainer welcomed a redesign toward a three-way `merge_with_ancestor` ([#337](https://github.com/sseemayer/keepass-rs/issues/337)).
  - An older issue reports KeePassXC raising conflict warnings after keepass-rs edits, due to `Times` handling ([#153](https://github.com/sseemayer/keepass-rs/issues/153), open).
  - Verified locally: the merge API compiles and runs in the wasm probe. Merge correctness was not exercised beyond upstream's tests.
- **kdbxweb.** `Kdbx.merge(remote)` is public [KW-merge]. It merges deleted objects, binaries, meta, and the group/entry trees. An entry takes the newer side by `lastModTime`, pushes the older state into history, and copies binaries [KW-entry-merge]. History merges as a remove-wins OR-set CRDT, with local tombstones the caller must persist through `getLocalEditState`/`setLocalEditState` [KW-merge] [KW-entry-merge]. It assumes one central upstream ("may produce inconsistencies while merging outdated replica outside main upstream"). KeeWeb used this in production for sync.
- **Reference.** KeePassXC's `Merger` is the behavior to match ([KX-merger]). Neither library claims parity with it.

### 5. Key files, composite keys, YubiKey

- **keepass-rs** [KR-key].
  - Composite key = SHA-256(password) + key file element + SHA-256(challenge-response result), when each is present.
  - Key file parsing order: XML (v1 base64, v2 hex) → 32-byte raw → 64-char hex → SHA-256 of the whole file. Fixtures include `.keyx` v2 files [KR-tests].
  - **The v2 `Hash` attribute is not checked** (`// TODO we should also validate the integrity of a v2 keyfile`, `src/key/mod.rs:68`).
  - Challenge-response is only `ChallengeResponseKey::{LocalChallenge(hex secret), YubikeyChallenge(Yubikey, slot)}` [KR-yubikey]. The response is computed internally over the KDF seed [KR-parse4]. There is **no callback, and no way to inject a precomputed response**: `challenge_response_result` is private. So a YubiKey through WebHID/WebUSB or through the Companion would need an upstream API change or a fork.
- **kdbxweb** [KW-creds].
  - Same key file formats (32-byte, 64-hex, XML v1/v2, hashed), and the v2 `Hash` **is verified**.
  - `Credentials(password, keyFile, challengeResponse)` takes a `KdbxChallengeResponseFn = (challenge) => Promise<bytes>`. That is exactly the asynchronous seam an extension would need for a Companion or WebHID YubiKey.

### 6. Maturity, security, license

- **keepass-rs.**
  - Development history goes back to 2016. In the last 12 months: 64 commits, mostly from two maintainers (louib 23, Stefan Seemayer 21) plus about 10 contributors. 173 stars, 20 open issues.
  - Since 2023, every PR needs a review by a maintainer who isn't the author [KR-AI].
  - The `AI-DECLARATION.md` says it was designed by humans, ">90%" of the implementation was written by humans, and it follows KeePassXC's AI policy [KR-AI].
  - Recent releases include breaking changes (`chore!`, `refactor!` commits, 0.x semver). The ownership model was refactored in April 2026 ([#294](https://github.com/sseemayer/keepass-rs/pull/294)).
  - Security policy: GitHub private reporting, best effort [KR-SECURITY]. No GitHub security advisories and no RustSec advisory for `keepass` (`crates/keepass` is absent from rustsec/advisory-db). **No independent audit found.**
  - Codecov reports 85.97% [Codecov-KR].
  - crates.io: 495k downloads total, 312k recent.
- **kdbxweb.**
  - Not archived, but the last npm release was 2021-09. The last commits (2024-12) are docs and lint. The new maintainer said in #49 that development was restarting, but nothing has merged since.
  - 455 stars. Open issues include a corruption/spec bug (#49) and a dependency CVE (#61), both without a maintainer response.
  - No advisories and **no audit found**. Coveralls reports 97.8%, measured at the last CI run (2024-12-24) [Coveralls-KW].
- **Licenses.** Both are MIT, which is GPL-3.0-compatible. The keepass-rs wasm dependency tree (83 crates, from `cargo tree`) is entirely MIT, Apache-2.0, Unlicense, CC0, Zlib, 0BSD or Unicode-3.0 dual-licensed options, all GPL-3.0-compatible. kdbxweb's dependencies (xmldom, fflate) are MIT.

### Other candidates

| Candidate | Status | Verdict |
|---|---|---|
| `keepass-ng` (crates.io 0.11.12) | Derivative of keepass-rs ("experimental support for KDBX4.1 writing" wording copied), 2 stars, about 1k recent downloads | Fork with a tiny user base. No advantage found |
| `kdbx-rs` (0.5.2, 2024-10, GitLab) | Low activity | Not credible as a core |
| `kdbx4` (0.5.1, 2021) | Read-only, stale | No |
| `kdbx` crate (daxartio) | A CLI app, not a library | No |
| `kdbx-wasm` (npm 0.3.1) | Rust→WASM wrapper, KDBX4 only, 0 stars | No |
| `@hazae41/kdbx` (npm 0.2.22) | KDBX4-only TS, 2 stars | No |
| `passxyzlib`, `passbolt-kdbxweb` | kdbxweb forks/republishes | Same code base as kdbxweb |
| KeePassXC core (C++/Qt, GPL-3.0) | Reference implementation, but tied to Qt (`QThread`, `QXmlStreamReader`) | Compiling to WASM is not realistic. Better treated as a Companion-side engine or as a spec oracle in tests |

pykeepass (Python/lxml, which works on the raw XML tree) was used only as a test tool here. It is not a browser candidate.

## Open risks / unknowns

- **Neither library guarantees lossless round trips.** Both drop unknown XML. keepass-rs also refuses some valid files: an unknown child in a Group, or non-contiguous repeated elements. The fixes (a catch-all for unknown elements, quick-xml `overlapped-lists`) would be upstream contributions, and nobody has measured how hard they are.
- **keepass-rs's forced upgrade to 4.1 on save** may break users on older clients. Strongbox and KeePassDX support for KDBX 4.1 was not verified here.
- **Merge gaps in keepass-rs:** attachments, icon ids and Meta are dropped or unmerged, and the API is unstable. kdbxweb's merge is more complete but unmaintained, and its CRDT assumes a single upstream. The fit with KeePassXC's `Merger` semantics wasn't tested empirically for either.
- **YubiKey:** only kdbxweb has a callback seam. keepass-rs would need an API like "provide the response for this seed". Whether the extension can reach a YubiKey at all (WebHID/WebUSB from an extension, or only through the Companion) is a separate question.
- **AES-KDF speed in keepass-rs WASM** (~0.8 s per 1M rounds) is bad for KeePass 2.x-style AES-KDF databases. A hybrid (KDF in WebCrypto, the rest in WASM) needs a keepass-rs API change.
- **Unlock latency:** at KeePassXC-tuned Argon2 parameters, any WASM core is about 3x slower than native, and only single-threaded WASM was measured. Measuring threaded WASM Argon2 under MV3 constraints (cross-origin isolation in the service worker or offscreen document) would be a separate spike.
- **Safari** WASM/CSP behavior for web extensions was not examined.
- **kdbxweb supply chain:** using it means forking or vendoring it (unpublished fixes, xmldom CVEs, #49). Its maintenance cost would move to rimlock.
- Strongbox- and KeePassDX-authored fixtures were not tested. Only KeePassXC output and pykeepass-injected data were.

## Method notes (reproducible)

All experiments ran in a scratch directory, not in this repo.

- keepass-rs was cloned at `d08c680` and built for `wasm32-unknown-unknown`. A probe `cdylib` exposes `open_count`, `roundtrip` (sets `KDB4(1)`, then saves) and `merge` through wasm-bindgen 0.2.129, run with `--target nodejs`.
- kdbxweb 2.1.1 came from npm, with `hash-wasm` providing Argon2.
- Fixtures were created with `keepassxc-cli` 2.7.12, then augmented with `pykeepass`, then dumped and normalized with lxml.
- The keepass-rs test suite was run natively with `save_kdbx4 _merge totp`.

## Sources

- [KR-Cargo]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/Cargo.toml
- [KR-cargo-config]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/.cargo/config.toml
- [KR-CI]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/.github/workflows/ci.yml#L203-L230
- [KR-wasm-test]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/tests/wasm_open_database.rs
- [KR-README]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/README.md
- [KR-lib]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/lib.rs
- [KR-xml-meta]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/format/xml_db/meta.rs
- [KR-xml-entry]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/format/xml_db/entry.rs#L22-L79
- [KR-xml-group]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/format/xml_db/group.rs#L66-L78
- [KR-entry]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/db/types/entry.rs#L61
- [KR-save]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/db/save.rs#L14-L19
- [KR-dump]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/format/kdbx4/dump.rs#L31-L33
- [KR-merge]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/db/merge.rs#L86-L92
- [KR-merge-todo]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/db/merge.rs#L576
- [KR-key]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/key/mod.rs
- [KR-yubikey]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/key/yubikey.rs#L15-L21
- [KR-parse4]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/format/kdbx4/parse.rs#L80
- [KR-kpxc-compat]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/tests/keepassxc_writer_compat_tests.rs
- [KR-cross-tool]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/tests/cross_tool.rs
- [KR-tests]: https://github.com/sseemayer/keepass-rs/tree/d08c68084cd40db9bacf38dbb151d478623fda2b/tests/resources
- [KR-AI]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/AI-DECLARATION.md
- [KR-SECURITY]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/SECURITY.md
- [Codecov-KR]: https://codecov.io/gh/sseemayer/keepass-rs (API `totals.coverage` = 85.97, updated 2026-09-30)
- [KW-README]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/README.md#kdbx4
- [KW-xml-utils]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/utils/xml-utils.ts#L23-L56
- [KW-entry-read]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/format/kdbx-entry.ts#L64-L110
- [KW-buildXml]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/format/kdbx.ts#L606-L617
- [KW-format]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/format/kdbx-format.ts#L120-L135
- [KW-consts]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/defs/consts.ts#L38-L41
- [KW-customdata]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/format/kdbx-custom-data.ts#L36
- [KW-meta-icons]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/format/kdbx-meta.ts#L421
- [KW-aes-kdf]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/crypto/key-encryptor-aes.ts
- [KW-merge]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/format/kdbx.ts#L394-L487
- [KW-entry-merge]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/format/kdbx-entry.ts#L369-L416
- [KW-creds]: https://github.com/keeweb/kdbxweb/blob/7601e45d2a437f35a7fa3d767164eab60bc05d42/lib/format/kdbx-credentials.ts#L18-L131
- [Coveralls-KW]: https://coveralls.io/github/keeweb/kdbxweb (`covered_percent` 97.83, 2024-12-24)
- kdbxweb issues: [#49](https://github.com/keeweb/kdbxweb/issues/49), [#59](https://github.com/keeweb/kdbxweb/issues/59), [#61](https://github.com/keeweb/kdbxweb/issues/61), PR [#62](https://github.com/keeweb/kdbxweb/pull/62); npm: https://www.npmjs.com/package/kdbxweb
- keepass-rs issues: [#153](https://github.com/sseemayer/keepass-rs/issues/153), [#243](https://github.com/sseemayer/keepass-rs/issues/243), [#336](https://github.com/sseemayer/keepass-rs/issues/336), [#337](https://github.com/sseemayer/keepass-rs/issues/337), [#360](https://github.com/sseemayer/keepass-rs/issues/360), [#373](https://github.com/sseemayer/keepass-rs/issues/373); PRs [#294](https://github.com/sseemayer/keepass-rs/pull/294), [#312](https://github.com/sseemayer/keepass-rs/pull/312)
- [KX-xmlreader]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KdbxXmlReader.cpp#L313
- [KX-writer]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KeePass2Writer.cpp#L55-L90
- [KX-argon2-h]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/crypto/kdf/Argon2Kdf.h#L23-L26
- [KX-argon2-cpp]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/crypto/kdf/Argon2Kdf.cpp#L37-L38
- [KX-kdf-h]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/crypto/kdf/Kdf.h#L26
- [KX-merger]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Merger.cpp
- [Chrome-CSP]: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
- [MDN-CSP]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_security_policy
- quick-xml 0.42 deserializer docs, "Overlapped (Out-of-Order) Elements": https://docs.rs/quick-xml/0.42.0/quick_xml/de/index.html#overlapped-out-of-order-elements
