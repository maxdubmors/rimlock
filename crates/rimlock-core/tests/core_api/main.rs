//! The public API of `rimlock-core` (`docs/spec/core-api.md`), on Databases from the generator.
//!
//! One test binary, so the generator compiles once and every part of it is used.

#![cfg(test)]

#[path = "../../examples/fixtures/generator/mod.rs"]
mod generator;

mod fixtures;
mod generator_output;
mod open;
mod read_header;
mod secrets;
mod unlock;
