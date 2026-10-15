//! `open`, the wake-up rebuild from a `CachedKey` (`docs/spec/core-api.md` § 3, ADR-0005).

use std::{cell::Cell, rc::Rc};

use rimlock_core::{CachedKey, Core, CoreError, Kdf, KdfParameters, RustKdf, TransformedKey};

use crate::{
    fixtures::{SEED, database, password_component},
    generator::saved_twice,
};

/// The real KDF, counting its runs.
#[derive(Clone, Default)]
struct CountingKdf(Rc<Cell<usize>>);

impl CountingKdf {
    fn runs(&self) -> usize {
        self.0.get()
    }
}

impl Kdf for CountingKdf {
    fn transform(
        &self,
        composite_key: &[u8; 32],
        kdf: &KdfParameters,
        seed: &[u8],
    ) -> Result<TransformedKey, CoreError> {
        self.0.set(self.0.get() + 1);
        RustKdf.transform(composite_key, kdf, seed)
    }
}

/// A KDF that must never run.
struct FailingKdf;

impl Kdf for FailingKdf {
    fn transform(
        &self,
        _: &[u8; 32],
        _: &KdfParameters,
        _: &[u8],
    ) -> Result<TransformedKey, CoreError> {
        panic!("the KDF ran");
    }
}

/// The file's bytes and the `CachedKey` its unlock returned.
fn unlocked(file: &str) -> (Vec<u8>, CachedKey) {
    let (bytes, components) = database(file);
    let unlocked = Core::default().unlock(&bytes, &components).unwrap();
    (bytes, unlocked.cached_key)
}

#[test]
fn unlock_runs_the_kdf_once_and_open_never() {
    let kdf = CountingKdf::default();
    let (bytes, components) = database("scenario.kdbx");
    let unlocked = Core::new(kdf.clone()).unlock(&bytes, &components).unwrap();
    assert_eq!(kdf.runs(), 1);

    let db = Core::new(kdf.clone())
        .open(&bytes, &unlocked.cached_key)
        .unwrap();
    assert_eq!(kdf.runs(), 1);
    assert_eq!(db.info(), unlocked.db.info());
}

#[test]
fn open_rebuilds_every_format_without_the_kdf() {
    for file in [
        "scenario.kdbx",
        "scenario-4.1-argon2id.kdbx",
        "scenario-4.0-argon2d.kdbx",
        "scenario-4.0-aes-kdf.kdbx",
        "scenario-3.1.kdbx",
        "scenario-key-file.kdbx",
        "scenario-password-key-file.kdbx",
    ] {
        let (bytes, cached_key) = unlocked(file);
        let db = Core::new(FailingKdf)
            .open(&bytes, &cached_key)
            .unwrap_or_else(|error| panic!("{file}: {error:?}"));
        assert_eq!(db.info().name, "rimlock scenario", "{file}");
    }
}

fn open_error(bytes: &[u8], cached_key: &CachedKey) -> CoreError {
    match Core::new(FailingKdf).open(bytes, cached_key) {
        Ok(_) => panic!("opened"),
        Err(error) => error,
    }
}

/// ADR-0005: KeePassXC and the other clients draw a fresh KDF seed on every save.
#[test]
fn another_clients_save_makes_the_cached_key_stale() {
    for plan in ["scenario", "scenario-4.0-aes-kdf", "scenario-3.1"] {
        let saved = saved_twice(plan, SEED).unwrap();
        let components = [password_component(
            saved.master_password.as_deref().unwrap(),
        )];
        let unlocked = Core::default().unlock(&saved.first, &components).unwrap();
        assert!(
            Core::new(FailingKdf)
                .open(&saved.first, &unlocked.cached_key)
                .is_ok(),
            "{plan}"
        );

        assert_eq!(
            open_error(&saved.second, &unlocked.cached_key),
            CoreError::CachedKeyStale,
            "{plan}"
        );
        // The Composite key has not changed: unlock, with the KDF, still opens it.
        assert!(
            Core::default().unlock(&saved.second, &components).is_ok(),
            "{plan}"
        );
    }
}

#[test]
fn other_kdf_parameters_under_the_same_seed_are_stale() {
    let (mut bytes, cached_key) = unlocked("scenario.kdbx");
    // The Argon2 iterations: a UInt64 item named "I" in the KDF parameters.
    let iterations = bytes
        .windows(10)
        .position(|window| window == [0x05, 1, 0, 0, 0, b'I', 8, 0, 0, 0])
        .unwrap()
        + 10;
    bytes[iterations] += 1;
    assert_eq!(open_error(&bytes, &cached_key), CoreError::CachedKeyStale);
}

#[test]
fn another_databases_cached_key_fails_cleanly() {
    let (_, cached_key) = unlocked("scenario-password-key-file.kdbx");
    for file in [
        "scenario.kdbx",
        "scenario-4.1-argon2id.kdbx",
        "scenario-4.0-aes-kdf.kdbx",
        "scenario-3.1.kdbx",
    ] {
        let (bytes, _) = database(file);
        assert!(
            matches!(
                open_error(&bytes, &cached_key),
                CoreError::CachedKeyStale | CoreError::WrongKey
            ),
            "{file}"
        );
    }
}

/// The format version leads the bytes, so a `CachedKey` from another rimlock version is stale.
#[test]
fn a_cached_key_of_another_format_is_stale() {
    let (bytes, cached_key) = unlocked("scenario.kdbx");
    let mut other = cached_key.expose().to_vec();
    other[0] = other[0].wrapping_add(1);
    assert_eq!(
        open_error(&bytes, &CachedKey::from(other)),
        CoreError::CachedKeyStale
    );
}

#[test]
fn damaged_cached_key_bytes_fail_cleanly() {
    for file in ["scenario.kdbx", "scenario-3.1.kdbx"] {
        let (bytes, cached_key) = unlocked(file);
        let cached = cached_key.expose();
        let mut damaged: Vec<Vec<u8>> = (0..cached.len())
            .map(|index| {
                let mut flipped = cached.to_vec();
                flipped[index] ^= 0x80;
                flipped
            })
            .collect();
        damaged.extend((0..cached.len()).map(|length| cached[..length].to_vec()));
        damaged.push([cached, &[0]].concat());
        for bytes_of_key in damaged {
            let result = Core::new(FailingKdf).open(&bytes, &CachedKey::from(bytes_of_key));
            assert!(
                matches!(
                    result,
                    Ok(_) | Err(CoreError::CachedKeyStale | CoreError::WrongKey)
                ),
                "{file}: {:?}",
                result.err()
            );
        }
    }
}
