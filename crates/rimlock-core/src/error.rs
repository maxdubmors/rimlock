//! The Core's errors (`docs/spec/core-api.md` § 8): UUIDs, field keys and reason codes, never content.

use uuid::Uuid;

/// Every way a Core call can fail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    /// The Composite key does not open the Database.
    WrongKey,
    /// Not a file the Core can read, such as a KeePass 1 file or an unknown cipher.
    UnsupportedFile { reason: UnsupportedReason },
    /// A KDBX file whose bytes are damaged.
    Corrupt { reason: CorruptReason },
    /// The Local copy's KDF seed or parameters no longer match the `CachedKey`.
    CachedKeyStale,
    /// A key-component provider must answer this challenge before the call can go on.
    ChallengeResponseRequired { challenge: Vec<u8> },
    /// The remote file no longer opens with the Database's key.
    RemoteKeyChanged,
    /// No Entry or Group has this UUID.
    NotFound { uuid: Uuid },
    /// The Entry changed since the given time.
    EntryChanged { uuid: Uuid },
    /// A change the Core refuses.
    InvalidChange { reason: InvalidChangeReason },
    /// A file the Core just produced did not read back as expected.
    VerifyFailed,
    /// A failure that is a bug in the Core or in its caller.
    Internal,
}

/// Why a file is `UnsupportedFile`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnsupportedReason {
    /// Not a KeePass file at all.
    NotKdbx,
    /// A KeePass 1 (`.kdb`) file.
    Kdb,
    /// A KDBX version other than 3.1, 4.0 and 4.1.
    FormatVersion,
    /// An outer cipher other than AES-256, `ChaCha20` and Twofish.
    Cipher,
    /// A compression other than none and `GZip`.
    Compression,
    /// A KDF other than Argon2d, Argon2id and AES-KDF.
    Kdf,
}

impl UnsupportedReason {
    /// The code that crosses the seam.
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Self::NotKdbx => "NotKdbx",
            Self::Kdb => "Kdb",
            Self::FormatVersion => "FormatVersion",
            Self::Cipher => "Cipher",
            Self::Compression => "Compression",
            Self::Kdf => "Kdf",
        }
    }
}

/// Why a file is `Corrupt`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorruptReason {
    /// The file ends early.
    Truncated,
    /// A header field is malformed or a required one is missing.
    Header,
    /// The KDF parameters are malformed.
    KdfParameters,
    /// The header does not match its own hash.
    HeaderHash,
    /// The encrypted payload fails its integrity check, decryption or decompression.
    Payload,
    /// The decrypted XML does not parse.
    Xml,
}

impl CorruptReason {
    /// The code that crosses the seam.
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Self::Truncated => "Truncated",
            Self::Header => "Header",
            Self::KdfParameters => "KdfParameters",
            Self::HeaderHash => "HeaderHash",
            Self::Payload => "Payload",
            Self::Xml => "Xml",
        }
    }
}

/// Why a change is an `InvalidChange` (`docs/spec/core-api.md` § 5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidChangeReason {
    /// A custom field key that is standard or interpreted by rimlock.
    ReservedKey,
    /// A custom field key the Entry already has.
    DuplicateKey,
    /// A recycle while the Database has its Recycle Bin turned off.
    RecycleBinDisabled,
}

impl InvalidChangeReason {
    /// The code that crosses the seam.
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Self::ReservedKey => "ReservedKey",
            Self::DuplicateKey => "DuplicateKey",
            Self::RecycleBinDisabled => "RecycleBinDisabled",
        }
    }
}
