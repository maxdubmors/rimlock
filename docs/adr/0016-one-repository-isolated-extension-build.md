# One repository; the Extension's build is isolated and reproducible

rimlock lives in one repository: shared Rust crates in `crates/` (`rimlock-core`, `rimlock-core-wasm`, later the native-messaging protocol), the Extension in `apps/extension`, and later one Companion per operating system in `apps/` (`companion-linux` on GTK4 + libadwaita, `companion-macos` as an Xcode project that also contains the Safari port). One repository lets a Core change land together with every consumer, lets the Extension and the Companion share one definition of their protocol, and keeps the Safari port next to the WXT build it wraps. The cost is that the Extension's AMO-reproducible build must not depend on anything the desktop apps bring in. So the root Cargo workspace holds only the crates the Extension builds, and each Companion is its own Cargo workspace with its own `Cargo.lock` that reaches `crates/` by path: GTK system libraries never enter the Extension's build container, and a desktop dependency bump never changes the Extension's `.wasm`.

## Considered Options

- **One Cargo workspace for everything** (desktop apps as non-default members). Rejected: one shared `Cargo.lock` means desktop dependency updates can shift crates the WASM build uses, changing its bytes and forcing a new AMO source review; `cargo … --workspace` would need GTK installed on every machine, including macOS and the release container.
- **Separate repositories per product.** Rejected: the Core and the protocol would be versioned across repositories, and every seam change would take coordinated releases.
- **The WXT app at the repository root.** Rejected: WXT, Vite, ESLint and Cargo configuration would mix at the root, and there would be no obvious home for the Companions.

## Consequences

- The generated TypeScript declarations of `rimlock-core-wasm` (`apps/extension/src/core-bindings/*.d.ts`) are committed, while the `.wasm` and JS glue are not. Every change to the Core's seam shows up in a pull request exactly as TypeScript sees it, can be checked against [`docs/spec/core-api.md`](../spec/core-api.md), and TypeScript-only work type-checks without a Rust toolchain. CI regenerates them and fails on a diff.
- The AMO source package covers the root workspace, `crates/` and `apps/extension`, not the Companions.
- Each product is versioned and tagged on its own (`extension-v…`, `companion-linux-v…`); CI runs per path.
- Every tool version is pinned (Rust toolchain, `wasm-bindgen` crate and CLI, Node, pnpm, exact npm versions, TypeScript 6.x), and the release build runs `scripts/build-release.sh` in a digest-pinned container with remapped paths; the same script runs without the container for reviewers. That the `.wasm` is byte-identical on x86_64 and aarch64 is still to be verified.
- Decision detail: [Decide the repository layout and build](https://github.com/maxdubmors/rimlock/issues/32).
