//! `unlock` and the Unlocked Database (`docs/spec/core-api.md` § 3–4).

use keepass::{
    Database, DatabaseKey,
    error::{
        BlockStreamError, CryptographyError, DatabaseFormatError, DatabaseOpenError,
        Kdbx3OpenError, Kdbx4OpenError,
    },
};
use uuid::Uuid;

use crate::{
    error::{CoreError, CorruptReason, UnsupportedReason},
    header::{FormatVersion, read_header},
    secret::KeyComponent,
};

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

/// Decrypts a `.kdbx` with the given Composite key; runs the KDF.
///
/// # Errors
///
/// What `read_header` returns for a file the Core cannot read; `WrongKey` when the components
/// do not open it, when they are empty, and for any `ChallengeResponse` component, since no
/// provider exists yet (ADR-0011); `Corrupt` for damage past the header.
pub fn unlock(bytes: &[u8], components: &[KeyComponent]) -> Result<UnlockedDatabase, CoreError> {
    let header = read_header(bytes)?;
    let key = database_key(components)?;
    let database =
        Database::parse(bytes, key).map_err(|error| open_error(&error, header.format_version))?;
    Ok(UnlockedDatabase {
        database,
        format_version: header.format_version,
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
    let corrupt = |reason| CoreError::Corrupt { reason };
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
        DatabaseOpenError::VersionParse(_) => CoreError::UnsupportedFile {
            reason: UnsupportedReason::NotKdbx,
        },
        DatabaseOpenError::UnsupportedVersion => CoreError::UnsupportedFile {
            reason: UnsupportedReason::FormatVersion,
        },
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
            DatabaseFormatError::Kdb(_) => CoreError::UnsupportedFile {
                reason: UnsupportedReason::Kdb,
            },
            _ => CoreError::Internal,
        },
        _ => CoreError::Internal,
    }
}
