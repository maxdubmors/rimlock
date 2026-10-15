//! The generator itself: deterministic, the promised sizes, and a canary for every secret kind.

use std::{collections::HashSet, fs};

use crate::{
    fixtures::{SEED, generate, shared},
    generator::CanaryKind,
};

fn files(dir: &std::path::Path) -> Vec<(String, Vec<u8>)> {
    let mut files: Vec<_> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            (
                entry.file_name().into_string().unwrap(),
                fs::read(entry.path()).unwrap(),
            )
        })
        .collect();
    files.sort();
    files
}

#[test]
fn the_same_seed_writes_the_same_bytes() {
    let again = generate("fixtures-same-seed", SEED);
    let expected = files(&shared().dir);
    assert_eq!(expected.len(), 13, "9 Databases, 2 Key files, 2 lists");
    assert!(
        files(&again.dir) == expected,
        "a second run with the same seed differs"
    );
}

#[test]
fn another_seed_writes_other_bytes() {
    let other = generate("fixtures-other-seed", SEED + 1);
    for ((name, bytes), (_, other_bytes)) in files(&shared().dir).iter().zip(files(&other.dir)) {
        assert_ne!(*bytes, other_bytes, "{name} does not depend on the seed");
    }
}

#[test]
fn the_reference_database_is_about_one_megabyte() {
    let size = shared().bytes("reference.kdbx").len();
    assert!(
        (900_000..1_200_000).contains(&size),
        "reference.kdbx is {size} bytes"
    );
}

#[test]
fn every_database_has_its_own_canaries_of_every_kind() {
    let fixtures = shared();
    for database in &fixtures.manifest.databases {
        let kinds: HashSet<_> = fixtures
            .manifest
            .canaries
            .iter()
            .filter(|canary| canary.database == database.file)
            .map(|canary| canary.kind)
            .collect();
        let mut expected = HashSet::from([CanaryKind::EntryPassword, CanaryKind::TotpSeed]);
        if database.master_password.is_some() {
            expected.insert(CanaryKind::MasterPassword);
        }
        if database.file != "reference.kdbx" {
            expected.insert(CanaryKind::ProtectedField);
        }
        assert!(
            kinds.is_superset(&expected),
            "{} has canaries {kinds:?}",
            database.file
        );
    }
    let values: HashSet<_> = fixtures
        .manifest
        .canaries
        .iter()
        .map(|canary| &canary.value)
        .collect();
    assert_eq!(
        values.len(),
        fixtures.manifest.canaries.len(),
        "a canary repeats"
    );
}

#[test]
fn the_canary_list_names_every_master_password() {
    let fixtures = shared();
    let listed: serde_json::Value =
        serde_json::from_slice(&fixtures.bytes("canaries.json")).unwrap();
    let listed: HashSet<&str> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|canary| canary["value"].as_str().unwrap())
        .collect();
    for database in &fixtures.manifest.databases {
        if let Some(password) = &database.master_password {
            assert!(
                listed.contains(password.as_str()),
                "{}'s Master password is not listed",
                database.file
            );
        }
    }
}
