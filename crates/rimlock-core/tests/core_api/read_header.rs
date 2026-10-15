//! `read_header` (`docs/spec/core-api.md` § 3): what a file says before any key.

use rimlock_core::{
    CoreError, CorruptReason, FormatVersion, KdfParameters, UnsupportedReason, read_header,
};

use crate::fixtures::shared;

fn header_of(file: &str) -> rimlock_core::HeaderInfo {
    read_header(&shared().bytes(file)).unwrap()
}

fn unsupported(reason: UnsupportedReason) -> CoreError {
    CoreError::UnsupportedFile { reason }
}

fn corrupt(reason: CorruptReason) -> CoreError {
    CoreError::Corrupt { reason }
}

/// The file with the first occurrence of `from` replaced by `to`.
fn patched(file: &str, from: &[u8], to: &[u8]) -> Vec<u8> {
    let mut bytes = shared().bytes(file);
    let at = bytes
        .windows(from.len())
        .position(|window| window == from)
        .unwrap();
    bytes[at..at + to.len()].copy_from_slice(to);
    bytes
}

const ARGON2D_UUID: [u8; 16] = [
    0xef, 0x63, 0x6d, 0xdf, 0x8c, 0x29, 0x44, 0x4b, 0x91, 0xf7, 0xa9, 0xa4, 0x03, 0xe3, 0x0a, 0x0c,
];
const AES256_UUID: [u8; 16] = [
    0x31, 0xc1, 0xf2, 0xe6, 0xbf, 0x71, 0x43, 0x50, 0xbe, 0x58, 0x05, 0x21, 0x6a, 0xfc, 0x5a, 0xff,
];

#[test]
fn reads_a_4_1_file_with_keepassxc_default_argon2d() {
    let header = header_of("reference.kdbx");
    assert_eq!(header.format_version, FormatVersion::V4_1);
    assert_eq!(
        header.kdf,
        KdfParameters::Argon2d {
            iterations: 10,
            memory_bytes: 64 * 1024 * 1024,
            parallelism: 4,
        }
    );
}

#[test]
fn reads_argon2id() {
    assert_eq!(
        header_of("scenario-4.1-argon2id.kdbx").kdf,
        KdfParameters::Argon2id {
            iterations: 2,
            memory_bytes: 1024 * 1024,
            parallelism: 2,
        }
    );
}

#[test]
fn reads_a_4_0_file() {
    let header = header_of("scenario-4.0-argon2d.kdbx");
    assert_eq!(header.format_version, FormatVersion::V4_0);
    assert_eq!(
        header.kdf,
        KdfParameters::Argon2d {
            iterations: 2,
            memory_bytes: 1024 * 1024,
            parallelism: 2,
        }
    );
    assert_eq!(
        header_of("scenario-4.0-aes-kdf.kdbx").kdf,
        KdfParameters::AesKdf { rounds: 1000 }
    );
}

#[test]
fn reads_a_3_1_file() {
    let header = header_of("scenario-3.1.kdbx");
    assert_eq!(header.format_version, FormatVersion::V3_1);
    assert_eq!(header.kdf, KdfParameters::AesKdf { rounds: 1000 });
}

#[test]
fn the_challenge_is_the_kdf_seed_from_the_header() {
    for file in [
        "scenario.kdbx",
        "scenario-4.0-aes-kdf.kdbx",
        "scenario-3.1.kdbx",
    ] {
        let bytes = shared().bytes(file);
        let challenge = read_header(&bytes).unwrap().challenge;
        assert_eq!(challenge.len(), 32, "{file}");
        // KDBX 4 keeps the seed in the KDF parameters as "S"; KDBX 3.1 as header field 5.
        let mut stored = if file == "scenario-3.1.kdbx" {
            vec![5, 32, 0]
        } else {
            vec![0x42, 1, 0, 0, 0, b'S', 32, 0, 0, 0]
        };
        stored.extend(&challenge);
        assert!(
            bytes.windows(stored.len()).any(|window| window == stored),
            "{file}"
        );
    }
}

#[test]
fn each_file_has_its_own_challenge() {
    assert_ne!(
        header_of("scenario.kdbx").challenge,
        header_of("scenario-4.0-argon2d.kdbx").challenge
    );
}

#[test]
fn an_empty_file_is_not_kdbx() {
    assert_eq!(
        read_header(&[]),
        Err(unsupported(UnsupportedReason::NotKdbx))
    );
}

#[test]
fn garbage_is_not_kdbx() {
    let garbage: Vec<u8> = (0..4096u32).map(|i| (i * 7 % 251) as u8).collect();
    assert_eq!(
        read_header(&garbage),
        Err(unsupported(UnsupportedReason::NotKdbx))
    );
}

#[test]
fn a_keepass_1_file_is_unsupported() {
    let kdb = [
        0x03, 0xD9, 0xA2, 0x9A, 0x65, 0xFB, 0x4B, 0xB5, 0x03, 0x00, 0x00, 0x00,
    ];
    assert_eq!(read_header(&kdb), Err(unsupported(UnsupportedReason::Kdb)));
}

#[test]
fn an_unknown_version_is_unsupported() {
    let mut bytes = shared().bytes("scenario.kdbx");
    bytes[8] = 2; // KDBX 4.2
    assert_eq!(
        read_header(&bytes),
        Err(unsupported(UnsupportedReason::FormatVersion))
    );
}

#[test]
fn an_unknown_cipher_is_unsupported() {
    let bytes = patched("scenario.kdbx", &AES256_UUID, &[0; 16]);
    assert_eq!(
        read_header(&bytes),
        Err(unsupported(UnsupportedReason::Cipher))
    );
}

#[test]
fn an_unknown_kdf_is_unsupported() {
    let bytes = patched("scenario.kdbx", &ARGON2D_UUID, &[0; 16]);
    assert_eq!(
        read_header(&bytes),
        Err(unsupported(UnsupportedReason::Kdf))
    );
}

#[test]
fn a_file_cut_inside_the_header_is_truncated() {
    let bytes = shared().bytes("scenario.kdbx");
    for length in [6, 12, 40, 150] {
        assert_eq!(
            read_header(&bytes[..length]),
            Err(corrupt(CorruptReason::Truncated)),
            "{length} bytes"
        );
    }
    let bytes = shared().bytes("scenario-3.1.kdbx");
    assert_eq!(
        read_header(&bytes[..100]),
        Err(corrupt(CorruptReason::Truncated))
    );
}

#[test]
fn malformed_kdf_parameters_are_corrupt() {
    // The variant dictionary's version 1.0 becomes 2.0.
    let bytes = patched("scenario.kdbx", &[0x00, 0x01, 0x42], &[0x00, 0x02, 0x42]);
    assert_eq!(
        read_header(&bytes),
        Err(corrupt(CorruptReason::KdfParameters))
    );
}
