//! `readHeader` (`docs/spec/core-api.md` § 3): what the outer KDBX header says without a key.
//!
//! keepass-rs parses the header only on the way to decrypting, so the Core reads it itself.
//! `unlock` reads it first too, so a file the Core cannot read fails the same way in both.

use crate::error::{CoreError, CorruptReason, UnsupportedReason};

/// The KDBX version of a file (`docs/spec/core-api.md` § 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormatVersion {
    V3_1,
    V4_0,
    V4_1,
}

/// The KDF and the parameters a settings screen would show.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KdfParameters {
    Argon2d {
        iterations: u64,
        memory_bytes: u64,
        parallelism: u32,
    },
    Argon2id {
        iterations: u64,
        memory_bytes: u64,
        parallelism: u32,
    },
    AesKdf {
        rounds: u64,
    },
}

/// What `readHeader` returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeaderInfo {
    pub format_version: FormatVersion,
    pub kdf: KdfParameters,
    /// The KDF seed: what a challenge-response provider answers.
    pub challenge: Vec<u8>,
}

const SIGNATURE_1: u32 = 0x9AA2_D903;
const SIGNATURE_2_KDB: u32 = 0xB54B_FB65;
const SIGNATURE_2_KDBX_PRERELEASE: u32 = 0xB54B_FB66;
const SIGNATURE_2_KDBX: u32 = 0xB54B_FB67;

const FIELD_END: u8 = 0;
const FIELD_CIPHER: u8 = 2;
const FIELD_COMPRESSION: u8 = 3;
const FIELD_TRANSFORM_SEED: u8 = 5;
const FIELD_TRANSFORM_ROUNDS: u8 = 6;
const FIELD_KDF_PARAMETERS: u8 = 11;

const CIPHER_AES256: [u8; 16] =
    *b"\x31\xc1\xf2\xe6\xbf\x71\x43\x50\xbe\x58\x05\x21\x6a\xfc\x5a\xff";
const CIPHER_TWOFISH: [u8; 16] =
    *b"\xad\x68\xf2\x9f\x57\x6f\x4b\xb9\xa3\x6a\xd4\x7a\xf9\x65\x34\x6c";
const CIPHER_CHACHA20: [u8; 16] =
    *b"\xd6\x03\x8a\x2b\x8b\x6f\x4c\xb5\xa5\x24\x33\x9a\x31\xdb\xb5\x9a";

const KDF_ARGON2D: [u8; 16] = *b"\xef\x63\x6d\xdf\x8c\x29\x44\x4b\x91\xf7\xa9\xa4\x03\xe3\x0a\x0c";
const KDF_ARGON2ID: [u8; 16] = *b"\x9e\x29\x8b\x19\x56\xdb\x47\x73\xb2\x3d\xfc\x3e\xc6\xf0\xa1\xe6";
const KDF_AES_KDBX4: [u8; 16] =
    *b"\xc9\xd9\xf3\x9a\x62\x8a\x44\x60\xbf\x74\x0d\x08\xc1\x8a\x4f\xea";
const KDF_AES_KDBX3: [u8; 16] =
    *b"\x7c\x02\xbb\x82\x79\xa7\x4a\xc0\x92\x7d\x11\x4a\x00\x64\x82\x38";

const VARIANT_UINT32: u8 = 0x04;
const VARIANT_UINT64: u8 = 0x05;
const VARIANT_BYTES: u8 = 0x42;

/// Reads the outer header of a KDBX file.
///
/// # Errors
///
/// `UnsupportedFile` for anything but KDBX 3.1, 4.0 or 4.1 with a cipher, compression and KDF
/// keepass-rs reads; `Corrupt` for a damaged header.
pub fn read_header(bytes: &[u8]) -> Result<HeaderInfo, CoreError> {
    let mut reader = Reader(bytes);
    if reader.u32().ok() != Some(SIGNATURE_1) {
        return Err(unsupported(UnsupportedReason::NotKdbx));
    }
    match reader.u32()? {
        SIGNATURE_2_KDBX | SIGNATURE_2_KDBX_PRERELEASE => {}
        SIGNATURE_2_KDB => return Err(unsupported(UnsupportedReason::Kdb)),
        _ => return Err(unsupported(UnsupportedReason::NotKdbx)),
    }
    let minor = reader.u16()?;
    let major = reader.u16()?;
    let format_version = match (major, minor) {
        (3, 1) => FormatVersion::V3_1,
        (4, 0) => FormatVersion::V4_0,
        (4, 1) => FormatVersion::V4_1,
        _ => return Err(unsupported(UnsupportedReason::FormatVersion)),
    };
    let kdbx3 = format_version == FormatVersion::V3_1;

    let mut cipher = false;
    let mut compression = false;
    let mut transform_seed = None;
    let mut transform_rounds = None;
    let mut kdf = None;
    loop {
        let id = reader.u8()?;
        let length = if kdbx3 {
            usize::from(reader.u16()?)
        } else {
            usize::try_from(reader.u32()?).map_err(|_| corrupt(CorruptReason::Truncated))?
        };
        let data = reader.take(length)?;
        match id {
            FIELD_END => break,
            FIELD_CIPHER => {
                if ![CIPHER_AES256, CIPHER_TWOFISH, CIPHER_CHACHA20]
                    .iter()
                    .any(|known| known == data)
                {
                    return Err(unsupported(UnsupportedReason::Cipher));
                }
                cipher = true;
            }
            FIELD_COMPRESSION => match Reader(data).exact_u32(CorruptReason::Header)? {
                0 | 1 => compression = true,
                _ => return Err(unsupported(UnsupportedReason::Compression)),
            },
            FIELD_TRANSFORM_SEED if kdbx3 => transform_seed = Some(data.to_vec()),
            FIELD_TRANSFORM_ROUNDS if kdbx3 => {
                transform_rounds = Some(Reader(data).exact_u64(CorruptReason::Header)?);
            }
            FIELD_KDF_PARAMETERS if !kdbx3 => kdf = Some(kdf_parameters(data)?),
            _ => {}
        }
    }
    if !cipher || !compression {
        return Err(corrupt(CorruptReason::Header));
    }
    let (kdf, challenge) = if kdbx3 {
        match (transform_rounds, transform_seed) {
            (Some(rounds), Some(seed)) => (KdfParameters::AesKdf { rounds }, seed),
            _ => return Err(corrupt(CorruptReason::Header)),
        }
    } else {
        kdf.ok_or(corrupt(CorruptReason::Header))?
    };
    Ok(HeaderInfo {
        format_version,
        kdf,
        challenge,
    })
}

/// The KDBX 4 `KdfParameters` variant dictionary: the KDF and its seed.
fn kdf_parameters(data: &[u8]) -> Result<(KdfParameters, Vec<u8>), CoreError> {
    let malformed = || corrupt(CorruptReason::KdfParameters);
    let mut reader = Reader(data);
    let version = reader.u16().map_err(|_| malformed())?;
    if version & 0xFF00 != 0x0100 {
        return Err(malformed());
    }
    let mut items = Vec::new();
    loop {
        let kind = reader.u8().map_err(|_| malformed())?;
        if kind == 0 {
            break;
        }
        let name_length = reader.u32().map_err(|_| malformed())?;
        let name = reader.take_u32(name_length).map_err(|_| malformed())?;
        let value_length = reader.u32().map_err(|_| malformed())?;
        let value = reader.take_u32(value_length).map_err(|_| malformed())?;
        items.push((name, kind, value));
    }
    let item = |name: &[u8], kind: u8| {
        items
            .iter()
            .find(|(item_name, item_kind, _)| *item_name == name && *item_kind == kind)
            .map(|(_, _, value)| *value)
            .ok_or_else(malformed)
    };
    let uint64 =
        |name: &[u8]| Reader(item(name, VARIANT_UINT64)?).exact_u64(CorruptReason::KdfParameters);
    let uint32 =
        |name: &[u8]| Reader(item(name, VARIANT_UINT32)?).exact_u32(CorruptReason::KdfParameters);
    let seed = item(b"S", VARIANT_BYTES)?.to_vec();

    let uuid = item(b"$UUID", VARIANT_BYTES)?;
    let kdf = if uuid == KDF_ARGON2D || uuid == KDF_ARGON2ID {
        let (iterations, memory_bytes, parallelism) = (uint64(b"I")?, uint64(b"M")?, uint32(b"P")?);
        if uuid == KDF_ARGON2D {
            KdfParameters::Argon2d {
                iterations,
                memory_bytes,
                parallelism,
            }
        } else {
            KdfParameters::Argon2id {
                iterations,
                memory_bytes,
                parallelism,
            }
        }
    } else if uuid == KDF_AES_KDBX4 || uuid == KDF_AES_KDBX3 {
        KdfParameters::AesKdf {
            rounds: uint64(b"R")?,
        }
    } else {
        return Err(unsupported(UnsupportedReason::Kdf));
    };
    Ok((kdf, seed))
}

fn unsupported(reason: UnsupportedReason) -> CoreError {
    CoreError::UnsupportedFile { reason }
}

fn corrupt(reason: CorruptReason) -> CoreError {
    CoreError::Corrupt { reason }
}

/// Little-endian reads that fail with `Corrupt { Truncated }` at the end of the bytes.
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], CoreError> {
        let (head, tail) = self
            .0
            .split_at_checked(length)
            .ok_or(corrupt(CorruptReason::Truncated))?;
        self.0 = tail;
        Ok(head)
    }

    fn take_u32(&mut self, length: u32) -> Result<&'a [u8], CoreError> {
        self.take(usize::try_from(length).map_err(|_| corrupt(CorruptReason::Truncated))?)
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], CoreError> {
        self.take(N)?
            .try_into()
            .map_err(|_| corrupt(CorruptReason::Truncated))
    }

    fn u8(&mut self) -> Result<u8, CoreError> {
        Ok(u8::from_le_bytes(self.array()?))
    }

    fn u16(&mut self) -> Result<u16, CoreError> {
        Ok(u16::from_le_bytes(self.array()?))
    }

    fn u32(&mut self) -> Result<u32, CoreError> {
        Ok(u32::from_le_bytes(self.array()?))
    }

    /// The whole remaining bytes as one `u32`; any other length is `reason`.
    fn exact_u32(self, reason: CorruptReason) -> Result<u32, CoreError> {
        Ok(u32::from_le_bytes(
            self.0.try_into().map_err(|_| corrupt(reason))?,
        ))
    }

    /// The whole remaining bytes as one `u64`; any other length is `reason`.
    fn exact_u64(self, reason: CorruptReason) -> Result<u64, CoreError> {
        Ok(u64::from_le_bytes(
            self.0.try_into().map_err(|_| corrupt(reason))?,
        ))
    }
}
