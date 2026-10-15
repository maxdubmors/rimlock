//! The lint rules of `docs/spec/engineering.md` § Checks hold for every crate the Extension
//! builds: a crate that does not inherit `[workspace.lints]` would escape them silently.

#![cfg(test)]

use std::fs;
use std::path::{Path, PathBuf};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("reading {}: {e}", path.display()))
}

/// The lines of one `[table]` of a TOML file, without comments and blank lines.
fn table<'a>(toml: &'a str, name: &str) -> Vec<&'a str> {
    let header = format!("[{name}]");
    toml.lines()
        .map(str::trim)
        .skip_while(|line| *line != header)
        .skip(1)
        .take_while(|line| !line.starts_with('['))
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect()
}

fn workspace_members() -> Vec<String> {
    let manifest = read(&workspace_root().join("Cargo.toml"));
    let (_, after) = manifest
        .split_once("members = [")
        .expect("the root Cargo.toml lists its members");
    let (members, _) = after.split_once(']').expect("the members list is closed");
    members
        .split(',')
        .map(|m| m.trim().trim_matches('"').to_owned())
        .filter(|m| !m.is_empty())
        .collect()
}

#[test]
fn every_workspace_crate_inherits_the_workspace_lints() {
    let members = workspace_members();
    assert!(members.contains(&"crates/rimlock-core".to_owned()));
    assert!(members.contains(&"crates/rimlock-core-wasm".to_owned()));
    for member in members {
        let manifest = read(&workspace_root().join(&member).join("Cargo.toml"));
        assert_eq!(
            table(&manifest, "lints"),
            ["workspace = true"],
            "{member} must inherit [workspace.lints] and add nothing of its own"
        );
    }
}

#[test]
fn the_workspace_denies_pedantic_clippy_and_the_panic_lints() {
    let manifest = read(&workspace_root().join("Cargo.toml"));
    let rust = table(&manifest, "workspace.lints.rust");
    assert!(rust.contains(&r#"unsafe_code = "deny""#));

    let clippy = table(&manifest, "workspace.lints.clippy");
    for group in ["all", "pedantic"] {
        assert!(
            clippy.contains(&format!(r#"{group} = {{ level = "deny", priority = -1 }}"#).as_str()),
            "clippy::{group} must be denied"
        );
    }
    for lint in [
        "unwrap_used",
        "expect_used",
        "panic",
        "indexing_slicing",
        "todo",
        "unimplemented",
        "dbg_macro",
        "print_stdout",
        "print_stderr",
        "allow_attributes",
        "allow_attributes_without_reason",
    ] {
        assert!(
            clippy.contains(&format!(r#"{lint} = "deny""#).as_str()),
            "clippy::{lint} must be denied"
        );
    }
    assert!(
        clippy
            .iter()
            .all(|line| !line.contains("allow") || line.starts_with("allow_attributes")),
        "no global exceptions: use #[expect(lint, reason = \"…\")]"
    );
}

#[test]
fn the_core_forbids_unsafe_code() {
    let lib = read(&workspace_root().join("crates/rimlock-core/src/lib.rs"));
    assert!(lib.lines().any(|line| line == "#![forbid(unsafe_code)]"));
}
