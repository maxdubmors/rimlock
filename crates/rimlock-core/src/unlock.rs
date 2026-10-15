//! `unlock`, `open` and the Unlocked Database (`docs/spec/core-api.md` § 3–4, ADR-0005).

use keepass::{
    Database, DatabaseKey,
    error::{
        BlockStreamError, CryptographyError, DatabaseFormatError, DatabaseOpenError,
        Kdbx3OpenError, Kdbx4OpenError,
    },
};
use uuid::Uuid;

use crate::{
    cached_key::CachedKey,
    error::{CoreError, CorruptReason, UnsupportedReason, corrupt, unsupported},
    header::{FormatVersion, read_header},
    kdf::{Kdf, RustKdf, TransformedKey},
    secret::KeyComponent,
};

/// The Core's injected dependencies: the KDF.
pub struct Core {
    kdf: Box<dyn Kdf>,
}

/// What `unlock` returns: the Database and the key material `open` rebuilds it from.
pub struct Unlocked {
    pub db: UnlockedDatabase,
    pub cached_key: CachedKey,
}

/// One Unlocked Database: the decrypted model, held by the background alone.
pub struct UnlockedDatabase {
    database: Database,
    format_version: FormatVersion,
}

/// What `info()` returns (`docs/spec/core-api.md` § 4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseInfo {
    pub name: String,
    pub root_group: Uuid,
    pub recycle_bin_enabled: bool,
    /// The Recycle Bin Group, when the Database names one that exists.
    pub recycle_bin: Option<Uuid>,
    /// As read; saves are always 4.1.
    pub format_version: FormatVersion,
}

impl UnlockedDatabase {
    /// The Database's name, root Group, Recycle Bin and format version.
    #[must_use]
    pub fn info(&self) -> DatabaseInfo {
        let meta = &self.database.meta;
        DatabaseInfo {
            name: meta.database_name.clone().unwrap_or_default(),
            root_group: self.database.root().id().uuid(),
            // KeePass reads a missing RecycleBinEnabled as on.
            recycle_bin_enabled: meta.recyclebin_enabled.unwrap_or(true),
            recycle_bin: self.database.recycle_bin().map(|group| group.id().uuid()),
            format_version: self.format_version,
        }
    }
}

impl Core {
    /// A Core that runs `kdf`.
    pub fn new(kdf: impl Kdf + 'static) -> Self {
        Self { kdf: Box::new(kdf) }
    }

    /// Decrypts a `.kdbx` with the given Composite key; runs the KDF.
    ///
    /// # Errors
    ///
    /// What `read_header` returns for a file the Core cannot read; `WrongKey` when the components
    /// do not open it, when they are empty, and for any `ChallengeResponse` component, since no
    /// provider exists yet and challenge-response is not supported for KDBX 3.1 (ADR-0011);
    /// `Corrupt` for damage past the header; `Internal` for a second password or Key file, a bug
    /// in the caller.
    pub fn unlock(&self, bytes: &[u8], components: &[KeyComponent]) -> Result<Unlocked, CoreError> {
        let header = read_header(bytes)?;
        let composite_key = database_key(components)?
            .composite_key()
            .map_err(|_| CoreError::Internal)?;
        let transformed_key = self
            .kdf
            .transform(&composite_key, &header.kdf, &header.challenge)?;
        let db = decrypt(bytes, &transformed_key, header.format_version)?;
        let cached_key = CachedKey::new(&composite_key, &transformed_key, &header);
        Ok(Unlocked { db, cached_key })
    }

    /// Rebuilds the Unlocked Database from the Local copy and its `CachedKey`; never runs the KDF.
    ///
    /// # Errors
    ///
    /// `CachedKeyStale` when the file's KDF seed or parameters differ from the cache's, as after
    /// another client saved it, or for a `CachedKey` of another format; `WrongKey` for one that
    /// does not open this file; otherwise what `unlock` returns for the file.
    pub fn open(
        &self,
        bytes: &[u8],
        cached_key: &CachedKey,
    ) -> Result<UnlockedDatabase, CoreError> {
        let header = read_header(bytes)?;
        let transformed_key = cached_key.transformed_key_for(&header)?;
        decrypt(bytes, &transformed_key, header.format_version)
    }
}

impl Default for Core {
    /// A Core that runs `RustKdf`.
    fn default() -> Self {
        Self::new(RustKdf)
    }
}

fn decrypt(
    bytes: &[u8],
    transformed_key: &TransformedKey,
    format_version: FormatVersion,
) -> Result<UnlockedDatabase, CoreError> {
    let database = Database::parse_with_transformed_key(bytes, transformed_key.expose())
        .map_err(|error| open_error(&error, format_version))?;
    Ok(UnlockedDatabase {
        database,
        format_version,
    })
}

/// The keepass-rs key: at most one password and one Key file.
fn database_key(components: &[KeyComponent]) -> Result<DatabaseKey, CoreError> {
    let mut key = DatabaseKey::new();
    let (mut password, mut key_file) = (false, false);
    for component in components {
        key = match component {
            KeyComponent::Password(value) if !password => {
                password = true;
                // Not UTF-8, so not a password anyone typed.
                key.with_password(str::from_utf8(value.expose()).map_err(|_| CoreError::WrongKey)?)
            }
            KeyComponent::KeyFile(bytes) if !key_file => {
                key_file = true;
                key.with_keyfile(&mut bytes.expose())
                    .map_err(|_| CoreError::Internal)?
            }
            KeyComponent::ChallengeResponse(_) => return Err(CoreError::WrongKey),
            KeyComponent::Password(_) | KeyComponent::KeyFile(_) => {
                return Err(CoreError::Internal);
            }
        };
    }
    if key.is_empty() {
        return Err(CoreError::WrongKey);
    }
    Ok(key)
}

/// keepass-rs's reasons, reduced to codes; `read_header` has already caught most header damage.
fn open_error(error: &DatabaseOpenError, format_version: FormatVersion) -> CoreError {
    match error {
        DatabaseOpenError::Key(_) => CoreError::WrongKey,
        // KDBX 3.1 has no header HMAC: keepass-rs decrypts the whole payload before it compares
        // the stream start bytes, so a wrong key almost always surfaces as bad padding.
        DatabaseOpenError::Cryptography(CryptographyError::InvalidPadding(_))
            if format_version == FormatVersion::V3_1 =>
        {
            CoreError::WrongKey
        }
        DatabaseOpenError::Cryptography(CryptographyError::Argon2(_)) => {
            corrupt(CorruptReason::KdfParameters)
        }
        DatabaseOpenError::Cryptography(CryptographyError::InvalidLength(_)) => {
            corrupt(CorruptReason::Header)
        }
        // The source is a byte slice, so the only I/O that can fail is decompression.
        DatabaseOpenError::Cryptography(_) | DatabaseOpenError::Io(_) => {
            corrupt(CorruptReason::Payload)
        }
        DatabaseOpenError::UnexpectedEof => corrupt(CorruptReason::Truncated),
        DatabaseOpenError::VersionParse(_) => unsupported(UnsupportedReason::NotKdbx),
        DatabaseOpenError::UnsupportedVersion => unsupported(UnsupportedReason::FormatVersion),
        DatabaseOpenError::Format(format) => match format {
            DatabaseFormatError::Kdbx4(Kdbx4OpenError::HeaderHashMismatch) => {
                corrupt(CorruptReason::HeaderHash)
            }
            DatabaseFormatError::Kdbx4(Kdbx4OpenError::BlockStream(BlockStreamError::Eof)) => {
                corrupt(CorruptReason::Truncated)
            }
            DatabaseFormatError::Kdbx4(
                Kdbx4OpenError::BlockStream(_) | Kdbx4OpenError::InnerHeader(_),
            )
            | DatabaseFormatError::Kdbx3(Kdbx3OpenError::BlockHashMismatch(_)) => {
                corrupt(CorruptReason::Payload)
            }
            DatabaseFormatError::Kdbx4(Kdbx4OpenError::OuterHeader(_))
            | DatabaseFormatError::Kdbx3(Kdbx3OpenError::OuterHeader(_)) => {
                corrupt(CorruptReason::Header)
            }
            DatabaseFormatError::Kdbx4(Kdbx4OpenError::Xml(_))
            | DatabaseFormatError::Kdbx3(Kdbx3OpenError::Xml(_)) => corrupt(CorruptReason::Xml),
            DatabaseFormatError::Kdb(_) => unsupported(UnsupportedReason::Kdb),
            _ => CoreError::Internal,
        },
        _ => CoreError::Internal,
    }
}
