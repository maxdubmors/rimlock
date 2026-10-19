//! `cargo run --locked -p rimlock-core --example fixtures -- [--seed N] [DIR]`
//!
//! Writes the test Databases, their Key files, `databases.json` (which key opens which file) and
//! `canaries.json` (every canary marker) to `DIR`, by default `target/fixtures`. Nothing generated
//! is committed.

mod generator;

use std::{
    io::{self, Write as _},
    path::PathBuf,
};

fn main() -> generator::Result<()> {
    let mut seed = 0;
    let mut dir = PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/fixtures"
    ));
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--seed" {
            seed = args.next().ok_or("--seed needs a number")?.parse()?;
        } else {
            dir = PathBuf::from(arg);
        }
    }
    let manifest = generator::write_all(&dir, seed)?;
    writeln!(
        io::stdout(),
        "{} Databases and {} canaries in {}",
        manifest.databases.len(),
        manifest.canaries.len(),
        dir.display()
    )?;
    Ok(())
}
