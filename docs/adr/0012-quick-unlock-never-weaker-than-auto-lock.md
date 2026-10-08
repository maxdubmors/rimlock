# Quick unlock is never weaker than Auto-lock, and it is post-MVP

Auto-lock exists for one adversary: someone at an unattended computer whose OS session is unlocked. That person can open the Extension's devtools and read or edit `storage.session` (the Extension Storage panel, Chrome 132+), so any secret the Extension checks by itself can be copied and guessed offline, and an attempt counter is no defence. A Quick unlock must hold against this adversary. Its wrapping secret is released only by hardware with user verification (WebAuthn PRF) or by the Companion, never by a PIN or a short password that the Extension checks. The wrapped key material lives only in `storage.session`, so it is gone after a browser restart, an Extension update or closing the last window. Nothing is written to disk, and ADR-0002 holds unchanged. A Quick unlock is offered only after an Auto-lock by T1 (time since last use), T2 (OS screen lock) or T3 (system idle). A manual Lock always requires the Composite key. The MVP ships no Quick unlock. Within one browser session it saves only the re-unlock after T1, T2 or T3. The only route without the Companion, WebAuthn PRF, is still fragmented. Firefox allows it only from Firefox 150, only with a web domain as RP ID and only in a tab, because the popup closes when the WebAuthn dialog opens. Windows Hello gives PRF only on recent Windows 11 builds, and Linux has no platform authenticator.

## Considered Options

- **PIN wrapping the key in `storage.session`** (Bitwarden's default PIN mode). Rejected: the devtools adversary copies the blob and guesses a short PIN offline, so Auto-lock becomes a curtain.
- **PIN-wrapped key on disk, surviving a browser restart** (Bitwarden's optional mode). Rejected: weaker than the `.kdbx` on disk (ADR-0002) and weaker than Auto-lock.
- **PIN checked by a server** (Proton Pass, server-side attempt limit). Not available: rimlock has no server and sends nothing anywhere (ADR-0002).
- **Hardware-wrapped key on disk, surviving a browser restart.** Rejected for now: it swaps "knows the Master password" for "has the device and its fingerprint or device PIN" for a stolen laptop. If it is ever wanted, it comes with the Companion and the OS keychain, as an amendment to ADR-0002.
- **WebAuthn PRF in the MVP.** Deferred: a domain rimlock must own forever, a tab-only flow in Firefox, a popup bug in Chrome on Linux, and a wide authenticator matrix to test, all for a gain limited to one browser session.
- **Companion only, dropping PRF for good.** Rejected: the platform gaps are recent and likely to close.

## Consequences

- The MVP leaves room for both routes. The lock procedure records its reason, so an Auto-lock by T1/T2/T3 can be told apart from a manual Lock and from losing `storage.session`. Restoring the Unlocked state goes through a single point that puts the hashed Composite key and the transformed-key cache back into `storage.session`, after which the usual wake-up rebuild runs (ADR-0005). The unlock screen has room for a second method.
- Quick unlock needs no new Core command, so it does not shape the unlock commands of the Core API.
- A future PRF design can avoid a second touch per session. At enrolment, derive a key pair from the PRF output and keep only the public key. After every unlock with the Composite key, seal the key material to that public key. A Quick unlock then needs a single PRF evaluation to open it. Always require user verification, because CTAP2 `hmac-secret` gives different outputs with and without it.
- When Quick unlock ships, the definition of Locked is refined, because Locked will then hold sealed key material.
- Decision detail: [Decide quick unlock](https://github.com/maxdubmors/rimlock/issues/22).
