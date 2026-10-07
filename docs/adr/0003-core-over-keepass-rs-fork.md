# The Core is a rimlock-owned Rust crate over a keepass-rs fork; the Core owns the Database, TypeScript owns the browser

The Core is a rimlock-owned Rust crate (`rimlock-core`), compiled to WASM for the Extension and reusable natively by the Companion. It wraps keepass-rs, consumed as a git dependency on a rimlock fork pinned to a commit. Every fix goes upstream as its own PR, the fork carries what has not merged yet, and we return to crates.io once it all has. We chose keepass-rs over kdbxweb even though kdbxweb already has most of what the MVP needs: whichever library we take, rimlock ends up owning a KDBX core. With keepass-rs we share that load with an active upstream and get a core the Companion can run natively, so one merge implementation serves both. With kdbxweb we would be the sole maintainers of an abandoned TypeScript library.

The boundary follows meaning, not convenience. The Core holds the decrypted Database and does everything that reads or writes its content: Composite key and KDF, KDBX read/write, Entry/Group edits, history, recycle bin, merge, search, TOTP codes, and the KeePass interop rules. TypeScript does everything that touches a browser API, a page, the network or the user: Source I/O (it hands the Core bytes and gets bytes back), UI, messaging, autofill, URL matching (reused from Bitwarden per ADR-0001) and the password generator.

## Considered Options

- **kdbxweb (vendored TS).** It already has full merge, a challenge-response callback, AES-KDF in WebCrypto and 4.0/3.1 writes. Rejected because it has been unmaintained since 2021, carries an xmldom CVE (and needs xmldom in a service worker, which has no `DOMParser`), has a CustomData date bug and no Twofish, and the Companion could not reuse it.
- **Thin Rust** (Rust only parses and encrypts, TS holds the decrypted model). Rejected because it puts every secret in the JS heap and leaves the interop rules where the Companion cannot reuse them.
- **Thick Rust** (URL matching and generator in Rust too). Rejected because it would mean porting Bitwarden's TS matcher away from the browser's URL and PSL handling.
- **Writing a KDBX library from scratch.** Rejected: the same work as fixing keepass-rs, without upstream's tests.

## Consequences

- keepass-rs types never cross the WASM boundary. The Core exposes a narrow command/query API. TS types are generated from Rust with `tsify` (`ts-rs` as fallback), and errors are a typed enum that arrives in TS as a discriminated union. Calls are async from TS.
- What crosses the boundary: `EntrySummary` (UUID, title, username, URLs, tags, Group path, icon, flags, has-TOTP, and `MatchingInfo`, which normalises `URL`/`KP2A_URL*`/`URL_n`/Kee/KeePassXC CustomData/AutoType opt-outs) crosses freely. Secrets (password, protected strings, TOTP seed, notes) cross only on an explicit per-use command and arrive in TS wrapped in a non-printable, non-serialisable `Secret`. In Rust they live in `zeroize` types. No full TS-side model of the Database exists.
- The keepass-rs fixes the MVP needs:
  - open Groups with unknown children (dropping them) and non-contiguous `<String>` (quick-xml `overlapped-lists`);
  - a KDF hook so AES-KDF runs in WebCrypto;
  - complete merge with attachments, icons and Meta, or an own merge in the Core;
  - v2 key file hash check;
  - never write above KDBX 4.1, with a verified 3.1 → 4.1 round trip.
- Opening from a cached transformed key and saving without re-running the KDF (reusing the KDF seed with a fresh master seed) are MVP fixes too, per ADR-0005. Note that KeePassXC does not do this: it draws a fresh KDF seed on every save.
- A challenge-response injection hook is not built for the MVP, but the API must leave room for it. KDBX 4.0 writes are not needed.
- The Rust toolchain enters the reproducible build AMO requires. The `.wasm` is built in a pinned container, and a Firefox WASM smoke test plus an AMO unlisted dry run come first in implementation.
- Decision detail: [Lock the stack and the TS/Rust split](https://github.com/maxdubmors/rimlock/issues/11).
