//! A deterministic KDBX writer: every seed and IV comes from the injected `Rng`.
//!
//! keepass-rs draws them from the operating system and writes only 4.1, so the generator
//! writes the container itself. It is independent of the reader under test, too.

use std::{error::Error, fmt::Write as _, io::Write as _};

use aes::{
    Aes256,
    cipher::{
        BlockCipherEncrypt, BlockModeEncrypt, KeyInit, KeyIvInit, StreamCipher,
        block_padding::Pkcs7,
    },
};
use flate2::{Compression, GzBuilder};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256, Sha512};

use super::{
    Rng,
    contents::Database,
    xml::{self, Dialect},
};

pub type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Clone, Copy)]
pub enum Format {
    V3_1,
    V4_0,
    V4_1,
}

impl Format {
    pub fn name(self) -> &'static str {
        match self {
            Self::V3_1 => "3.1",
            Self::V4_0 => "4.0",
            Self::V4_1 => "4.1",
        }
    }
}

#[derive(Clone, Copy)]
pub enum Kdf {
    Argon2d {
        iterations: u32,
        memory_kib: u32,
        parallelism: u32,
    },
    Argon2id {
        iterations: u32,
        memory_kib: u32,
        parallelism: u32,
    },
    Aes {
        rounds: u64,
    },
}

impl Kdf {
    pub fn name(self) -> &'static str {
        match self {
            Self::Argon2d { .. } => "Argon2d",
            Self::Argon2id { .. } => "Argon2id",
            Self::Aes { .. } => "AesKdf",
        }
    }
}

/// The Composite key: a Master password, a Key file, or both.
pub struct Key {
    pub password: Option<String>,
    pub key_file: Option<KeyFile>,
}

/// A KeePass 2.x XML Key file, version 2.0.
pub struct KeyFile {
    pub contents: Vec<u8>,
    key: [u8; 32],
}

impl KeyFile {
    pub fn new(rng: &mut Rng) -> Self {
        let key: [u8; 32] = rng.bytes();
        let hex = upper_hex(&key);
        let groups: Vec<&str> = hex
            .as_bytes()
            .chunks(8)
            .filter_map(|chunk| str::from_utf8(chunk).ok())
            .collect();
        let check = upper_hex(Sha256::digest(key).get(..4).unwrap_or_default());
        let contents = format!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<KeyFile>\n\t<Meta>\n\t\t<Version>2.0</Version>\n\t</Meta>\n\
             \t<Key>\n\t\t<Data Hash=\"{check}\">\n\t\t\t{}\n\t\t\t{}\n\t\t</Data>\n\t</Key>\n</KeyFile>\n",
            groups.get(..4).unwrap_or_default().join(" "),
            groups.get(4..).unwrap_or_default().join(" "),
        );
        Self {
            contents: contents.into_bytes(),
            key,
        }
    }
}

const SIGNATURE: [u8; 8] = [0x03, 0xD9, 0xA2, 0x9A, 0x67, 0xFB, 0x4B, 0xB5];
const CIPHER_AES256: [u8; 16] =
    *b"\x31\xc1\xf2\xe6\xbf\x71\x43\x50\xbe\x58\x05\x21\x6a\xfc\x5a\xff";
const KDF_ARGON2D: [u8; 16] = *b"\xef\x63\x6d\xdf\x8c\x29\x44\x4b\x91\xf7\xa9\xa4\x03\xe3\x0a\x0c";
const KDF_ARGON2ID: [u8; 16] = *b"\x9e\x29\x8b\x19\x56\xdb\x47\x73\xb2\x3d\xfc\x3e\xc6\xf0\xa1\xe6";
const KDF_AES_KDBX4: [u8; 16] =
    *b"\xc9\xd9\xf3\x9a\x62\x8a\x44\x60\xbf\x74\x0d\x08\xc1\x8a\x4f\xea";
const END_OF_HEADER: &[u8] = b"\r\n\r\n";
const GZIP: u32 = 1;
const SALSA20: u32 = 2;
const CHACHA20: u32 = 3;
const SALSA20_NONCE: [u8; 8] = [0xE8, 0x30, 0x09, 0x4B, 0x97, 0x20, 0x5D, 0x2A];
const BLOCK_SIZE: usize = 1 << 20;

/// Encrypts `database` as a `.kdbx` of `format`.
pub fn write(
    database: &Database,
    format: Format,
    kdf: Kdf,
    key: &Key,
    rng: &mut Rng,
) -> Result<Vec<u8>> {
    match format {
        Format::V3_1 => write_kdbx3(database, kdf, key, rng),
        Format::V4_0 => write_kdbx4(database, 0, kdf, key, rng),
        Format::V4_1 => write_kdbx4(database, 1, kdf, key, rng),
    }
}

fn write_kdbx3(database: &Database, kdf: Kdf, key: &Key, rng: &mut Rng) -> Result<Vec<u8>> {
    let Kdf::Aes { rounds } = kdf else {
        return Err("KDBX 3.1 has only AES-KDF".into());
    };
    let master_seed: [u8; 32] = rng.bytes();
    let transform_seed: [u8; 32] = rng.bytes();
    let iv: [u8; 16] = rng.bytes();
    let stream_key: [u8; 32] = rng.bytes();
    let stream_start: [u8; 32] = rng.bytes();

    let mut header = SIGNATURE.to_vec();
    header.extend(version(3, 1));
    let mut field = |id: u8, data: &[u8]| -> Result<()> {
        header.push(id);
        header.extend(u16::try_from(data.len())?.to_le_bytes());
        header.extend(data);
        Ok(())
    };
    field(2, &CIPHER_AES256)?;
    field(3, &GZIP.to_le_bytes())?;
    field(4, &master_seed)?;
    field(5, &transform_seed)?;
    field(6, &rounds.to_le_bytes())?;
    field(7, &iv)?;
    field(8, &stream_key)?;
    field(9, &stream_start)?;
    field(10, &SALSA20.to_le_bytes())?;
    field(0, END_OF_HEADER)?;

    let mut inner = salsa20::Salsa20::new_from_slices(&Sha256::digest(stream_key), &SALSA20_NONCE)?;
    let header_hash = Sha256::digest(&header);
    let xml = xml::document(
        database,
        Dialect::Kdbx3 {
            header_hash: &header_hash,
        },
        &mut |value| keystream_xor(&mut inner, value),
    );
    let compressed = gzip(xml.as_bytes())?;

    // The hashed block stream: index, SHA-256, length, data; an empty block ends it.
    let mut plain = stream_start.to_vec();
    let mut index = 0u32;
    for block in compressed.chunks(BLOCK_SIZE) {
        plain.extend(index.to_le_bytes());
        plain.extend(Sha256::digest(block));
        plain.extend(u32::try_from(block.len())?.to_le_bytes());
        plain.extend(block);
        index += 1;
    }
    plain.extend(index.to_le_bytes());
    plain.extend([0; 32]);
    plain.extend(0u32.to_le_bytes());

    let transformed = transform(kdf, &composite(key), &transform_seed)?;
    let cipher_key = Sha256::new()
        .chain_update(master_seed)
        .chain_update(transformed)
        .finalize();
    let mut file = header;
    file.extend(aes_cbc(&cipher_key, &iv, &plain)?);
    Ok(file)
}

fn write_kdbx4(
    database: &Database,
    minor: u16,
    kdf: Kdf,
    key: &Key,
    rng: &mut Rng,
) -> Result<Vec<u8>> {
    let master_seed: [u8; 32] = rng.bytes();
    let iv: [u8; 16] = rng.bytes();
    let kdf_seed: [u8; 32] = rng.bytes();
    let stream_key: [u8; 64] = rng.bytes();

    let mut header = SIGNATURE.to_vec();
    header.extend(version(4, minor));
    let mut field = |id: u8, data: &[u8]| -> Result<()> {
        header.push(id);
        header.extend(u32::try_from(data.len())?.to_le_bytes());
        header.extend(data);
        Ok(())
    };
    field(2, &CIPHER_AES256)?;
    field(3, &GZIP.to_le_bytes())?;
    field(4, &master_seed)?;
    field(7, &iv)?;
    field(11, &kdf_parameters(kdf, &kdf_seed)?)?;
    field(0, END_OF_HEADER)?;

    let mut payload = Vec::new();
    for (id, data) in [
        (1u8, &CHACHA20.to_le_bytes()[..]),
        (2, &stream_key[..]),
        (0, &[][..]),
    ] {
        payload.push(id);
        payload.extend(u32::try_from(data.len())?.to_le_bytes());
        payload.extend(data);
    }
    let stream = Sha512::digest(stream_key);
    let (stream_cipher_key, stream_nonce) = stream.split_at(32);
    let mut inner = chacha20::ChaCha20::new_from_slices(
        stream_cipher_key,
        stream_nonce.get(..12).unwrap_or_default(),
    )?;
    let xml = xml::document(database, Dialect::Kdbx4, &mut |value| {
        keystream_xor(&mut inner, value)
    });
    payload.extend(xml.as_bytes());

    let transformed = transform(kdf, &composite(key), &kdf_seed)?;
    let cipher_key = Sha256::new()
        .chain_update(master_seed)
        .chain_update(transformed)
        .finalize();
    let hmac_key = Sha512::new()
        .chain_update(master_seed)
        .chain_update(transformed)
        .chain_update([1])
        .finalize();
    let block_key = |index: u64| {
        Sha512::new()
            .chain_update(index.to_le_bytes())
            .chain_update(hmac_key)
            .finalize()
    };
    let encrypted = aes_cbc(&cipher_key, &iv, &gzip(&payload)?)?;

    let mut file = header.clone();
    file.extend(Sha256::digest(&header));
    file.extend(hmac(&block_key(u64::MAX), &[&header])?);
    // The HMAC block stream: HMAC, length, data; an empty block ends it.
    let mut blocks: Vec<&[u8]> = encrypted.chunks(BLOCK_SIZE).collect();
    blocks.push(&[]);
    for (index, block) in (0u64..).zip(blocks) {
        let length = u32::try_from(block.len())?.to_le_bytes();
        file.extend(hmac(
            &block_key(index),
            &[&index.to_le_bytes(), &length, block],
        )?);
        file.extend(length);
        file.extend(block);
    }
    Ok(file)
}

fn version(major: u16, minor: u16) -> [u8; 4] {
    let [minor_low, minor_high] = minor.to_le_bytes();
    let [major_low, major_high] = major.to_le_bytes();
    [minor_low, minor_high, major_low, major_high]
}

/// The `KdfParameters` variant dictionary of KDBX 4.
fn kdf_parameters(kdf: Kdf, seed: &[u8]) -> Result<Vec<u8>> {
    let mut dictionary = vec![0x00, 0x01];
    let mut item = |kind: u8, name: &str, value: &[u8]| -> Result<()> {
        dictionary.push(kind);
        dictionary.extend(u32::try_from(name.len())?.to_le_bytes());
        dictionary.extend(name.as_bytes());
        dictionary.extend(u32::try_from(value.len())?.to_le_bytes());
        dictionary.extend(value);
        Ok(())
    };
    match kdf {
        Kdf::Argon2d {
            iterations,
            memory_kib,
            parallelism,
        }
        | Kdf::Argon2id {
            iterations,
            memory_kib,
            parallelism,
        } => {
            let uuid = if matches!(kdf, Kdf::Argon2d { .. }) {
                KDF_ARGON2D
            } else {
                KDF_ARGON2ID
            };
            item(0x42, "$UUID", &uuid)?;
            item(0x42, "S", seed)?;
            item(0x04, "P", &parallelism.to_le_bytes())?;
            item(0x05, "M", &(u64::from(memory_kib) * 1024).to_le_bytes())?;
            item(0x05, "I", &u64::from(iterations).to_le_bytes())?;
            item(0x04, "V", &0x13u32.to_le_bytes())?;
        }
        Kdf::Aes { rounds } => {
            item(0x42, "$UUID", &KDF_AES_KDBX4)?;
            item(0x05, "R", &rounds.to_le_bytes())?;
            item(0x42, "S", seed)?;
        }
    }
    dictionary.push(0);
    Ok(dictionary)
}

/// SHA-256 over the SHA-256 of the password and the Key file's key.
fn composite(key: &Key) -> [u8; 32] {
    let mut hash = Sha256::new();
    if let Some(password) = &key.password {
        hash.update(Sha256::digest(password.as_bytes()));
    }
    if let Some(key_file) = &key.key_file {
        hash.update(key_file.key);
    }
    hash.finalize().into()
}

fn transform(kdf: Kdf, composite: &[u8; 32], seed: &[u8]) -> Result<[u8; 32]> {
    let argon2 = |variant, iterations, memory_kib, lanes| -> Result<[u8; 32]> {
        let config = argon2::Config {
            ad: &[],
            hash_length: 32,
            lanes,
            mem_cost: memory_kib,
            secret: &[],
            thread_mode: argon2::ThreadMode::Sequential,
            time_cost: iterations,
            variant,
            version: argon2::Version::Version13,
        };
        let hash = argon2::hash_raw(composite, seed, &config)?;
        Ok(hash.as_slice().try_into()?)
    };
    match kdf {
        Kdf::Argon2d {
            iterations,
            memory_kib,
            parallelism,
        } => argon2(
            argon2::Variant::Argon2d,
            iterations,
            memory_kib,
            parallelism,
        ),
        Kdf::Argon2id {
            iterations,
            memory_kib,
            parallelism,
        } => argon2(
            argon2::Variant::Argon2id,
            iterations,
            memory_kib,
            parallelism,
        ),
        Kdf::Aes { rounds } => {
            let cipher = Aes256::new_from_slice(seed)?;
            let (first, second) = composite.split_at(16);
            let mut blocks = [aes::Block::try_from(first)?, aes::Block::try_from(second)?];
            for _ in 0..rounds {
                cipher.encrypt_blocks(&mut blocks);
            }
            let [first, second] = blocks;
            Ok(Sha256::new()
                .chain_update(first)
                .chain_update(second)
                .finalize()
                .into())
        }
    }
}

fn aes_cbc(key: &[u8], iv: &[u8], plain: &[u8]) -> Result<Vec<u8>> {
    Ok(cbc::Encryptor::<Aes256>::new_from_slices(key, iv)?.encrypt_padded_vec::<Pkcs7>(plain))
}

fn hmac(key: &[u8], parts: &[&[u8]]) -> Result<Vec<u8>> {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(key)?;
    for part in parts {
        mac.update(part);
    }
    Ok(mac.finalize().into_bytes().to_vec())
}

/// `GZip` with no file name and a zero time, so the bytes depend on the input alone.
fn gzip(data: &[u8]) -> Result<Vec<u8>> {
    let mut encoder = GzBuilder::new()
        .mtime(0)
        .write(Vec::new(), Compression::default());
    encoder.write_all(data)?;
    Ok(encoder.finish()?)
}

fn upper_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut hex, byte| {
        let _ = write!(hex, "{byte:02X}");
        hex
    })
}

fn keystream_xor(cipher: &mut impl StreamCipher, value: &[u8]) -> Vec<u8> {
    let mut buffer = value.to_vec();
    cipher.apply_keystream(&mut buffer);
    buffer
}
