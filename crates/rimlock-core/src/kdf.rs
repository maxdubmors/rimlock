//! The KDF: the slow step of unlock, injected so a test can count its runs (ADR-0005).

use std::fmt;

use aes::{
    Aes256,
    cipher::{BlockCipherEncrypt, KeyInit},
};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::{
    error::{CoreError, CorruptReason, corrupt},
    header::KdfParameters,
};

/// The hashed Composite key after the KDF: what decrypts the file, together with its master seed.
///
/// Zeroed on drop. `Debug` prints a placeholder, like `SecretBytes`.
pub struct TransformedKey(Zeroizing<[u8; 32]>);

impl TransformedKey {
    /// The bytes, for the one call that needs them.
    #[must_use]
    pub fn expose(&self) -> &[u8; 32] {
        &self.0
    }
}

impl From<[u8; 32]> for TransformedKey {
    fn from(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }
}

impl fmt::Debug for TransformedKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("TransformedKey(..)")
    }
}

/// Transforms a hashed Composite key with a file's KDF.
pub trait Kdf {
    /// Runs `kdf` seeded with `seed` (the header's challenge) on `composite_key`.
    ///
    /// # Errors
    ///
    /// `Corrupt` for parameters the KDF cannot run with.
    fn transform(
        &self,
        composite_key: &[u8; 32],
        kdf: &KdfParameters,
        seed: &[u8],
    ) -> Result<TransformedKey, CoreError>;
}

/// The KDF in Rust: Argon2 on one thread, as WASM has no others, and AES-KDF.
pub struct RustKdf;

impl Kdf for RustKdf {
    fn transform(
        &self,
        composite_key: &[u8; 32],
        kdf: &KdfParameters,
        seed: &[u8],
    ) -> Result<TransformedKey, CoreError> {
        match *kdf {
            KdfParameters::Argon2d {
                iterations,
                memory_bytes,
                parallelism,
                version,
            } => argon2(
                argon2::Variant::Argon2d,
                (iterations, memory_bytes, parallelism, version),
                composite_key,
                seed,
            ),
            KdfParameters::Argon2id {
                iterations,
                memory_bytes,
                parallelism,
                version,
            } => argon2(
                argon2::Variant::Argon2id,
                (iterations, memory_bytes, parallelism, version),
                composite_key,
                seed,
            ),
            KdfParameters::AesKdf { rounds } => aes_kdf(rounds, composite_key, seed),
        }
    }
}

/// Argon2 with `(iterations, memory_bytes, parallelism, version)`, as KeePass calls it.
fn argon2(
    variant: argon2::Variant,
    (iterations, memory_bytes, parallelism, version): (u64, u64, u32, u32),
    composite_key: &[u8; 32],
    seed: &[u8],
) -> Result<TransformedKey, CoreError> {
    let malformed = || corrupt(CorruptReason::KdfParameters);
    let config = argon2::Config {
        ad: &[],
        hash_length: 32,
        lanes: parallelism,
        mem_cost: u32::try_from(memory_bytes / 1024).map_err(|_| malformed())?,
        secret: &[],
        thread_mode: argon2::ThreadMode::Sequential,
        time_cost: u32::try_from(iterations).map_err(|_| malformed())?,
        variant,
        version: argon2::Version::from_u32(version).map_err(|_| malformed())?,
    };
    let hash =
        Zeroizing::new(argon2::hash_raw(composite_key, seed, &config).map_err(|_| malformed())?);
    let bytes: [u8; 32] = hash.as_slice().try_into().map_err(|_| malformed())?;
    Ok(TransformedKey::from(bytes))
}

/// AES-KDF: `rounds` AES-256 encryptions of both halves under the seed, then SHA-256.
fn aes_kdf(
    rounds: u64,
    composite_key: &[u8; 32],
    seed: &[u8],
) -> Result<TransformedKey, CoreError> {
    let cipher = Aes256::new_from_slice(seed).map_err(|_| corrupt(CorruptReason::Header))?;
    let (first, second) = composite_key.split_at(16);
    let block = |half: &[u8]| aes::Block::try_from(half).map_err(|_| CoreError::Internal);
    let mut blocks = [block(first)?, block(second)?];
    for _ in 0..rounds {
        cipher.encrypt_blocks(&mut blocks);
    }
    let [first, second] = &blocks;
    let transformed_key: [u8; 32] = Sha256::new()
        .chain_update(first)
        .chain_update(second)
        .finalize()
        .into();
    for block in &mut blocks {
        block.as_mut_slice().zeroize();
    }
    Ok(TransformedKey::from(transformed_key))
}
