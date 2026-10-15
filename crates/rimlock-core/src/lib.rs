//! The rimlock Core: everything that touches KeePass data (`docs/spec/core-api.md`).
//!
//! Pure Rust with no `wasm-bindgen`, so the Companion can link it natively;
//! the bindings live in `rimlock-core-wasm`. keepass-rs types never leave this crate.

#![forbid(unsafe_code)]

mod error;
mod header;
mod secret;
mod unlock;

pub use error::{CoreError, CorruptReason, InvalidChangeReason, UnsupportedReason};
pub use header::{FormatVersion, HeaderInfo, KdfParameters, read_header};
pub use secret::{KeyComponent, SecretBytes};
pub use unlock::{DatabaseInfo, UnlockedDatabase, unlock};

/// The Core's version: the `rimlock-core` crate version it was built from.
#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
