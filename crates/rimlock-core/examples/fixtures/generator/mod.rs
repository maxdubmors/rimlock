//! The test-Database generator (`docs/spec/engineering.md` § Tests): the same seed gives the
//! same bytes, with no real time and no real randomness.
//!
//! `main.rs` runs it for the end-to-end tests; `tests/core_api` includes it with `#[path]`.

mod contents;
mod kdbx;
mod xml;

use std::{fmt::Write as _, fs, path::Path};

use chacha20::{
    ChaCha20,
    cipher::{KeyIvInit, StreamCipher},
};
use serde::Serialize;
use sha2::{Digest, Sha256};

use contents::Builder;
pub use kdbx::Result;
use kdbx::{Format, Kdf, Key, KeyFile};

/// The fixed "now" every generated time derives from: 2026-01-01T00:00:00Z.
pub const NOW: i64 = 1_767_225_600;

/// The injected clock.
#[derive(Clone, Copy)]
pub struct Clock {
    pub now: i64,
}

/// The injected RNG: the `ChaCha20` keystream of a key derived from the seed.
pub struct Rng(ChaCha20);

impl Rng {
    pub fn new(seed: u64) -> Self {
        let key = Sha256::new()
            .chain_update(b"rimlock fixtures")
            .chain_update(seed.to_le_bytes())
            .finalize();
        Self(ChaCha20::new(&key, &chacha20::Nonce::default()))
    }

    pub fn bytes<const N: usize>(&mut self) -> [u8; N] {
        let mut bytes = [0; N];
        self.0.apply_keystream(&mut bytes);
        bytes
    }

    /// A number in `0..bound`; the modulo bias does not matter for test data.
    pub fn below(&mut self, bound: u32) -> u32 {
        u32::from_le_bytes(self.bytes()) % bound.max(1)
    }

    pub fn hex(&mut self, bytes: usize) -> String {
        (0..bytes).fold(String::new(), |mut hex, _| {
            let [byte] = self.bytes();
            let _ = write!(hex, "{byte:02x}");
            hex
        })
    }

    pub fn alphanumeric(&mut self, length: usize) -> String {
        self.pick(
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
            length,
        )
    }

    pub fn base32(&mut self, length: usize) -> String {
        self.pick(b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", length)
    }

    fn pick(&mut self, alphabet: &[u8], length: usize) -> String {
        let bound = u32::try_from(alphabet.len()).unwrap_or(1);
        (0..length)
            .filter_map(|_| {
                let index = usize::try_from(self.below(bound)).ok()?;
                alphabet.get(index).map(|&byte| char::from(byte))
            })
            .collect()
    }
}

/// A secret the canary check looks for wherever it must not be.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Canary {
    pub database: String,
    pub kind: CanaryKind,
    pub value: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
pub enum CanaryKind {
    MasterPassword,
    EntryPassword,
    TotpSeed,
    ProtectedField,
}

/// One generated Database and the key that opens it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Generated {
    pub file: String,
    pub format_version: &'static str,
    pub kdf: &'static str,
    pub master_password: Option<String>,
    pub key_file: Option<String>,
}

/// Everything `write_all` wrote, as `databases.json` and `canaries.json` say it.
pub struct Manifest {
    pub databases: Vec<Generated>,
    pub canaries: Vec<Canary>,
}

#[derive(Clone, Copy)]
enum Contents {
    Scenario,
    Reference,
}

struct Plan {
    name: &'static str,
    contents: Contents,
    format: Format,
    kdf: Kdf,
    password: bool,
    key_file: bool,
}

/// KeePassXC's defaults before its one-second benchmark (KeePassXC 2.7, `Argon2Kdf.h`).
const KEEPASSXC_DEFAULT: Kdf = Kdf::Argon2d {
    iterations: 10,
    memory_kib: 64 * 1024,
    parallelism: 4,
};
const LOW_ARGON2D: Kdf = Kdf::Argon2d {
    iterations: 2,
    memory_kib: 1024,
    parallelism: 2,
};
const LOW_ARGON2ID: Kdf = Kdf::Argon2id {
    iterations: 2,
    memory_kib: 1024,
    parallelism: 2,
};
const LOW_AES: Kdf = Kdf::Aes { rounds: 1000 };

const PLANS: [Plan; 8] = [
    // The end-to-end scenarios unlock it many times, so it has a low KDF.
    plan("scenario", Contents::Scenario, Format::V4_1, LOW_ARGON2D),
    plan(
        "reference",
        Contents::Reference,
        Format::V4_1,
        KEEPASSXC_DEFAULT,
    ),
    // Variants for the formats, KDFs and keys a user's file may have.
    plan(
        "scenario-4.1-argon2id",
        Contents::Scenario,
        Format::V4_1,
        LOW_ARGON2ID,
    ),
    plan(
        "scenario-4.0-argon2d",
        Contents::Scenario,
        Format::V4_0,
        LOW_ARGON2D,
    ),
    plan(
        "scenario-4.0-aes-kdf",
        Contents::Scenario,
        Format::V4_0,
        LOW_AES,
    ),
    plan("scenario-3.1", Contents::Scenario, Format::V3_1, LOW_AES),
    Plan {
        key_file: true,
        ..plan(
            "scenario-password-key-file",
            Contents::Scenario,
            Format::V4_1,
            LOW_ARGON2D,
        )
    },
    Plan {
        password: false,
        key_file: true,
        ..plan(
            "scenario-key-file",
            Contents::Scenario,
            Format::V4_1,
            LOW_ARGON2D,
        )
    },
];

const fn plan(name: &'static str, contents: Contents, format: Format, kdf: Kdf) -> Plan {
    Plan {
        name,
        contents,
        format,
        kdf,
        password: true,
        key_file: false,
    }
}

/// A plan's Database and the Composite key that opens it.
fn build(
    plan: &Plan,
    rng: &mut Rng,
    clock: Clock,
    canaries: &mut Vec<Canary>,
    file: &str,
) -> (contents::Database, Key) {
    let mut builder = Builder::new(rng, clock, canaries, file);
    let master_password = plan.password.then(|| builder.master_password());
    let database = match plan.contents {
        Contents::Scenario => builder.scenario(),
        Contents::Reference => builder.reference(),
    };
    let key = Key {
        password: master_password,
        key_file: plan.key_file.then(|| KeyFile::new(rng)),
    };
    (database, key)
}

/// One Database saved twice, as another client re-saves a file: the same Database, KDF and
/// Composite key, but each save with its own master seed, KDF seed and IVs (ADR-0005).
#[cfg(test)]
pub struct SavedTwice {
    pub master_password: Option<String>,
    pub first: Vec<u8>,
    pub second: Vec<u8>,
}

/// The Database of the plan named `name`, saved twice; not written to disk.
#[cfg(test)]
pub fn saved_twice(name: &str, seed: u64) -> Result<SavedTwice> {
    let plan = PLANS
        .iter()
        .find(|plan| plan.name == name)
        .ok_or("no such plan")?;
    let mut rng = Rng::new(seed);
    let (database, key) = build(plan, &mut rng, Clock { now: NOW }, &mut Vec::new(), name);
    let first = kdbx::write(&database, plan.format, plan.kdf, &key, &mut rng)?;
    let second = kdbx::write(&database, plan.format, plan.kdf, &key, &mut rng)?;
    Ok(SavedTwice {
        master_password: key.password,
        first,
        second,
    })
}

/// Writes every test Database, its Key file if any, `databases.json` and `canaries.json` to `dir`.
pub fn write_all(dir: &Path, seed: u64) -> Result<Manifest> {
    fs::create_dir_all(dir)?;
    let mut rng = Rng::new(seed);
    let clock = Clock { now: NOW };
    let mut manifest = Manifest {
        databases: Vec::new(),
        canaries: Vec::new(),
    };
    for plan in &PLANS {
        let file = format!("{}.kdbx", plan.name);
        let (database, key) = build(plan, &mut rng, clock, &mut manifest.canaries, &file);
        let master_password = key.password.clone();
        let key_file = match &key.key_file {
            Some(key_file) => {
                let name = format!("{}.keyx", plan.name);
                fs::write(dir.join(&name), &key_file.contents)?;
                Some(name)
            }
            None => None,
        };
        fs::write(
            dir.join(&file),
            kdbx::write(&database, plan.format, plan.kdf, &key, &mut rng)?,
        )?;
        manifest.databases.push(Generated {
            file,
            format_version: plan.format.name(),
            kdf: plan.kdf.name(),
            master_password,
            key_file,
        });
    }
    fs::write(
        dir.join("databases.json"),
        serde_json::to_vec_pretty(&manifest.databases)?,
    )?;
    fs::write(
        dir.join("canaries.json"),
        serde_json::to_vec_pretty(&manifest.canaries)?,
    )?;
    Ok(manifest)
}
