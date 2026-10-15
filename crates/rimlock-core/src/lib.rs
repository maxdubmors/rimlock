//! The rimlock Core: everything that touches KeePass data (`docs/spec/core-api.md`).
//!
//! Pure Rust with no `wasm-bindgen`, so the Companion can link it natively;
//! the bindings live in `rimlock-core-wasm`. keepass-rs types never leave this crate.

#![forbid(unsafe_code)]

mod cached_key;
mod error;
mod header;
mod kdf;
mod secret;
mod unlock;

pub use cached_key::CachedKey;
pub use error::{CoreError, CorruptReason, InvalidChangeReason, UnsupportedReason};
pub use header::{FormatVersion, HeaderInfo, KdfParameters, read_header};
pub use kdf::{Kdf, RustKdf, TransformedKey};
pub use secret::{KeyComponent, SecretBytes};
pub use unlock::{Core, DatabaseInfo, Unlocked, UnlockedDatabase};

/// The Core's version: the `rimlock-core` crate version it was built from.
#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
