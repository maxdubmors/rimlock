//! The rimlock Core: everything that touches KeePass data (`docs/spec/core-api.md`).
//!
//! Pure Rust with no `wasm-bindgen`, so the Companion can link it natively;
//! the bindings live in `rimlock-core-wasm`.
