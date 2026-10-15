//! The `CachedKey` (`docs/spec/core-api.md` § 2, ADR-0005): what `storage.session` keeps so the
//! background can rebuild the Unlocked Database on wake-up without running the KDF.

use crate::{
    error::CoreError,
    header::{HeaderInfo, KdfParameters},
    kdf::TransformedKey,
    secret::SecretBytes,
};

/// Opaque, versioned key material: the hashed Composite key, and the transformed key with the
/// KDF seed and parameters it is tied to. TypeScript stores the bytes and never parses them.
#[derive(Debug)]
pub struct CachedKey(SecretBytes);

/// Bumped whenever the layout below changes: an older `CachedKey` is then `CachedKeyStale`.
///
/// Layout: the format byte, the hashed Composite key (32 bytes), the transformed key (32 bytes),
/// then what ties it to the file: the KDF, its parameters and the seed (`kdf_binding`).
const FORMAT: u8 = 1;
const KEY_LENGTH: usize = 32;

impl CachedKey {
    /// The bytes TypeScript stores.
    #[must_use]
    pub fn expose(&self) -> &[u8] {
        self.0.expose()
    }

    pub(crate) fn new(
        composite_key: &[u8; 32],
        transformed_key: &TransformedKey,
        header: &HeaderInfo,
    ) -> Self {
        let binding = kdf_binding(header);
        let mut bytes = Vec::with_capacity(1 + 2 * KEY_LENGTH + binding.len());
        bytes.push(FORMAT);
        bytes.extend_from_slice(composite_key);
        bytes.extend_from_slice(transformed_key.expose());
        bytes.extend_from_slice(&binding);
        Self(SecretBytes::from(bytes))
    }

    /// The transformed key, if it is tied to the KDF seed and parameters in `header`.
    ///
    /// # Errors
    ///
    /// `CachedKeyStale` when they differ, or for bytes of another format or length.
    pub(crate) fn transformed_key_for(
        &self,
        header: &HeaderInfo,
    ) -> Result<TransformedKey, CoreError> {
        let stale = || CoreError::CachedKeyStale;
        let (format, rest) = self.expose().split_first().ok_or_else(stale)?;
        if *format != FORMAT {
            return Err(stale());
        }
        let (_composite_key, rest) = rest.split_at_checked(KEY_LENGTH).ok_or_else(stale)?;
        let (transformed_key, binding) = rest.split_at_checked(KEY_LENGTH).ok_or_else(stale)?;
        if binding != kdf_binding(header) {
            return Err(stale());
        }
        let transformed_key: [u8; 32] = transformed_key.try_into().map_err(|_| stale())?;
        Ok(TransformedKey::from(transformed_key))
    }
}

impl From<Vec<u8>> for CachedKey {
    fn from(bytes: Vec<u8>) -> Self {
        Self(SecretBytes::from(bytes))
    }
}

/// The KDF, its parameters and its seed, as bytes: equal exactly when the KDF would give the same
/// transformed key for the same Composite key.
fn kdf_binding(header: &HeaderInfo) -> Vec<u8> {
    let mut bytes = Vec::new();
    match header.kdf {
        KdfParameters::Argon2d {
            iterations,
            memory_bytes,
            parallelism,
            version,
        }
        | KdfParameters::Argon2id {
            iterations,
            memory_bytes,
            parallelism,
            version,
        } => {
            bytes.push(if matches!(header.kdf, KdfParameters::Argon2d { .. }) {
                1
            } else {
                2
            });
            bytes.extend(iterations.to_le_bytes());
            bytes.extend(memory_bytes.to_le_bytes());
            bytes.extend(parallelism.to_le_bytes());
            bytes.extend(version.to_le_bytes());
        }
        KdfParameters::AesKdf { rounds } => {
            bytes.push(3);
            bytes.extend(rounds.to_le_bytes());
        }
    }
    bytes.extend(&header.challenge);
    bytes
}
