//! The rimlock Core: everything that touches KeePass data (`docs/spec/core-api.md`).
//!
//! Pure Rust with no `wasm-bindgen`, so the Companion can link it natively;
//! the bindings live in `rimlock-core-wasm`.

#![forbid(unsafe_code)]

/// The Core's version: the `rimlock-core` crate version it was built from.
#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
