//! The interop corpus (`docs/spec/engineering.md` § Tests): files other KeePass clients saved, in
//! `tests/corpus/`, each opened with the key its `manifest.json` names and checked against what
//! the manifest says about it.
//!
//! `RIMLOCK_CORPUS` points the same tests at another directory of the same shape:
//! `pnpm test:interop` runs them on the files `keepassxc-cli` has just created.

#![cfg(test)]

use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

use rimlock_core::{Core, FormatVersion, KdfParameters, KeyComponent, SecretBytes, read_header};
use serde::Deserialize;

/// One entry of `manifest.json`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CorpusFile {
    file: String,
    /// The client that saved the file, and its version.
    client: String,
    version: String,
    /// How the file was made, for the next person who has to make one like it.
    #[expect(
        dead_code,
        reason = "read by people; deserialising it makes it required"
    )]
    made: String,
    master_password: Option<String>,
    key_file: Option<String>,
    header: Header,
    contents: Contents,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    format_version: String,
    kdf: ManifestKdf,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum ManifestKdf {
    Argon2d {
        iterations: u64,
        memory_bytes: u64,
        parallelism: u32,
        version: u32,
    },
    Argon2id {
        iterations: u64,
        memory_bytes: u64,
        parallelism: u32,
        version: u32,
    },
    AesKdf {
        rounds: u64,
    },
}

/// What the Core can read of a file's contents so far.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Contents {
    name: String,
    /// The Recycle Bin is on and its Group exists.
    recycle_bin: bool,
}

impl ManifestKdf {
    fn parameters(&self) -> KdfParameters {
        match *self {
            Self::Argon2d {
                iterations,
                memory_bytes,
                parallelism,
                version,
            } => KdfParameters::Argon2d {
                iterations,
                memory_bytes,
                parallelism,
                version,
            },
            Self::Argon2id {
                iterations,
                memory_bytes,
                parallelism,
                version,
            } => KdfParameters::Argon2id {
                iterations,
                memory_bytes,
                parallelism,
                version,
            },
            Self::AesKdf { rounds } => KdfParameters::AesKdf { rounds },
        }
    }
}

fn format_version(version: &str) -> FormatVersion {
    match version {
        "3.1" => FormatVersion::V3_1,
        "4.0" => FormatVersion::V4_0,
        "4.1" => FormatVersion::V4_1,
        other => panic!("unknown format version {other}"),
    }
}

fn corpus_dir() -> PathBuf {
    std::env::var_os("RIMLOCK_CORPUS").map_or_else(
        || Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus"),
        PathBuf::from,
    )
}

fn manifest(dir: &Path) -> Vec<CorpusFile> {
    let manifest = dir.join("manifest.json");
    let text = fs::read_to_string(&manifest)
        .unwrap_or_else(|error| panic!("{}: {error}", manifest.display()));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{}: {error}", manifest.display()))
}

/// What is wrong with one file, if anything.
fn check(dir: &Path, entry: &CorpusFile) -> Result<(), String> {
    let bytes = fs::read(dir.join(&entry.file)).map_err(|error| error.to_string())?;

    let header = read_header(&bytes).map_err(|error| format!("read_header: {error:?}"))?;
    let expected = (
        format_version(&entry.header.format_version),
        entry.header.kdf.parameters(),
    );
    if (header.format_version, header.kdf) != expected {
        return Err(format!(
            "read_header gives {:?} {:?}, the manifest {expected:?}",
            header.format_version, header.kdf
        ));
    }

    let mut components = Vec::new();
    if let Some(password) = &entry.master_password {
        components.push(KeyComponent::Password(SecretBytes::from(
            password.as_bytes().to_vec(),
        )));
    }
    if let Some(key_file) = &entry.key_file {
        let key_file = fs::read(dir.join(key_file)).map_err(|error| error.to_string())?;
        components.push(KeyComponent::KeyFile(SecretBytes::from(key_file)));
    }
    let info = Core::default()
        .unlock(&bytes, &components)
        .map_err(|error| format!("unlock: {error:?}"))?
        .db
        .info();

    let recycle_bin =
        info.recycle_bin_enabled && info.recycle_bin.is_some_and(|bin| bin != info.root_group);
    if info.name != entry.contents.name || recycle_bin != entry.contents.recycle_bin {
        return Err(format!(
            "name {:?} and Recycle Bin {recycle_bin}, the manifest {:?} and {}",
            info.name, entry.contents.name, entry.contents.recycle_bin
        ));
    }
    Ok(())
}

#[test]
fn every_file_opens_with_its_key_and_reads_as_the_manifest_says() {
    let dir = corpus_dir();
    let manifest = manifest(&dir);
    assert!(!manifest.is_empty(), "{}: an empty manifest", dir.display());
    let failures: Vec<String> = manifest
        .iter()
        .filter_map(|entry| {
            check(&dir, entry).err().map(|failure| {
                format!(
                    "{} ({} {}): {failure}",
                    entry.file, entry.client, entry.version
                )
            })
        })
        .collect();
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

/// A file the manifest does not list is never opened, and a listed file must exist.
#[test]
fn the_manifest_lists_every_file_in_the_corpus() {
    let dir = corpus_dir();
    let listed: BTreeSet<String> = manifest(&dir)
        .into_iter()
        .flat_map(|entry| [Some(entry.file), entry.key_file])
        .flatten()
        .collect();
    let present: BTreeSet<String> = fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .filter(|name| name != "manifest.json")
        .collect();
    assert_eq!(listed, present, "{}", dir.display());
}
