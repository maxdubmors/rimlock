//! The generated Databases, written once per test run.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use rimlock_core::{KeyComponent, SecretBytes};

use crate::generator::{self, Generated, Manifest};

pub const SEED: u64 = 45;

pub struct Fixtures {
    pub dir: PathBuf,
    pub manifest: Manifest,
}

/// Generated into a fresh directory under Cargo's temporary directory for integration tests.
pub fn generate(name: &str, seed: u64) -> Fixtures {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = fs::remove_dir_all(&dir);
    let manifest = generator::write_all(&dir, seed).unwrap();
    Fixtures { dir, manifest }
}

pub fn shared() -> &'static Fixtures {
    static SHARED: OnceLock<Fixtures> = OnceLock::new();
    SHARED.get_or_init(|| generate("fixtures-shared", SEED))
}

impl Fixtures {
    pub fn database(&self, file: &str) -> &Generated {
        self.manifest
            .databases
            .iter()
            .find(|database| database.file == file)
            .unwrap_or_else(|| panic!("no {file} generated"))
    }

    pub fn bytes(&self, file: &str) -> Vec<u8> {
        fs::read(self.dir.join(file)).unwrap()
    }
}

/// The file's bytes and the components that open it.
pub fn database(file: &str) -> (Vec<u8>, Vec<KeyComponent>) {
    let fixtures = shared();
    let generated = fixtures.database(file);
    let mut components = Vec::new();
    if let Some(password) = &generated.master_password {
        components.push(password_component(password));
    }
    if let Some(key_file) = &generated.key_file {
        components.push(KeyComponent::KeyFile(SecretBytes::from(
            fixtures.bytes(key_file),
        )));
    }
    (fixtures.bytes(file), components)
}

pub fn password_component(password: &str) -> KeyComponent {
    KeyComponent::Password(SecretBytes::from(password.as_bytes().to_vec()))
}
