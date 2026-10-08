# The Companion is a capability provider; the Extension stays the sole owner of the Unlocked Database

The Companion adds only what a browser cannot do: key components (the YubiKey challenge-response), Source access (a live local file in Firefox, WebDAV servers with self-signed certificates) and, possibly, quick unlock. It never holds the Extension's Unlocked Database. The Extension works the same with and without it: ADR-0005 holds unchanged, and the Companion only plugs in extra providers behind seams the MVP already has. The Extension and the Companion speak rimlock's own versioned protocol over native messaging. The background connects on demand and disconnects after the request, so the Unlocked state never depends on a live port. A challenge-response Database needs the YubiKey only at unlock and when another client has saved the file. rimlock's own saves reuse the KDF seed (ADR-0005), so the response, already folded into the hashed Composite key in `storage.session`, stays valid.

## Considered Options

- **The Companion holds the Database and the Extension becomes a thin client** (the KeePassXC-Browser model). Rejected: the Extension would need two modes, with two threat models and two Auto-lock paths. Future Companion features that need an open Database (SSH agent, Auto-Type) are not precluded: the Companion opens the file as one more client through the shared Core, and Merge reconciles the writes.
- **Query a running KeePassXC through `keepassxc-proxy`.** Rejected: KeePassXC never hands out key material, its host manifest admits only keepassxc-browser IDs, and it needs the Database unlocked in its own GUI. rimlock would become a KeePassXC-Browser clone.
- **A fresh challenge on every save** (KeePassXC). Rejected: every save would need the YubiKey present.
- **Cache challenge/response pairs on disk** (Strongbox). Rejected: a cached response is key material, and nothing on disk may be stronger than the `.kdbx` (ADR-0002).
- **Channel encryption and pairing keys** (KeePassXC's NaCl box, Bitwarden's RSA + AES). Rejected for the first protocol version: the browser already admits only rimlock's IDs to the host, the host checks the caller origin, and the only other party that could reach the Companion's socket is a process of the same OS user, which ADR-0002 puts out of reach. The handshake leaves room for pairing.
- **Keep the native port open to keep the background alive.** Rejected: it works around the MV3 lifetime that ADR-0005 is built on.

## Consequences

- The Composite key is a list of components in the Core from day one, including a challenge-response component computed from the KDF seed. Unlock and Merge run in two phases: the Core returns the challenge, TypeScript asks a key-component provider, and the response goes back to the Core. A software HMAC serves as the reference provider in Core tests.
- Source access sits behind an adapter with a version token (`lastModified`/`size` or ETag), a conditional write and an optional watch. Merge-before-write (ADR-0007, ADR-0008) runs above it. Messages from the Companion are capped at 1 MB, so the protocol chunks Database bytes.
- The first message is a handshake carrying the protocol version and the Companion's capabilities. Using the Companion is opt-in on both sides: `nativeMessaging` is an optional permission in the Extension, and the Companion lets the user allow each browser.
- The MVP ships fixed Extension IDs (an explicit `gecko.id`, a Chrome key for development builds) so that host manifests can name them. It does not declare `nativeMessaging`.
- The Core is a pure Rust crate, and the WASM bindings live in a separate crate, so the Companion can link the Core natively.
- In the MVP a challenge-response Database fails to open with a wrong-key error, because nothing in the KDBX header marks it. A browser-only software HMAC secret ("virtual YubiKey") is post-MVP.
- On Safari the Companion is the containing macOS app. Installing native hosts for Flatpak and Snap browsers is the Companion's concern.
- Decision detail: [Decide the Companion seam](https://github.com/maxdubmors/rimlock/issues/21). Facts: [Companion seam: native messaging and YubiKey](https://github.com/maxdubmors/rimlock/issues/7).
