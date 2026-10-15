//! `unlock` and `UnlockedDatabase::info` (`docs/spec/core-api.md` § 3–4, § 8).

use rimlock_core::{
    CoreError, CorruptReason, FormatVersion, KeyComponent, SecretBytes, UnsupportedReason, unlock,
};

use crate::fixtures::{database, password_component, shared};

fn unlock_error(bytes: &[u8], components: &[KeyComponent]) -> CoreError {
    match unlock(bytes, components) {
        Ok(_) => panic!("unlocked"),
        Err(error) => error,
    }
}

#[test]
fn unlocks_every_format_with_the_master_password() {
    for (file, format_version) in [
        ("scenario-4.1-argon2d.kdbx", FormatVersion::V4_1),
        ("scenario-4.1-argon2id.kdbx", FormatVersion::V4_1),
        ("scenario-4.0-argon2d.kdbx", FormatVersion::V4_0),
        ("scenario-4.0-aes-kdf.kdbx", FormatVersion::V4_0),
        ("scenario-3.1.kdbx", FormatVersion::V3_1),
    ] {
        let (bytes, components) = database(file);
        let info = unlock(&bytes, &components)
            .unwrap_or_else(|error| panic!("{file}: {error:?}"))
            .info();
        assert_eq!(info.name, "rimlock scenario", "{file}");
        assert_eq!(info.format_version, format_version, "{file}");
        assert!(info.recycle_bin_enabled, "{file}");
        assert!(
            info.recycle_bin.is_some_and(|bin| bin != info.root_group),
            "{file}"
        );
    }
}

#[test]
fn unlocks_the_reference_database_at_keepassxc_defaults() {
    let (bytes, components) = database("reference.kdbx");
    let info = unlock(&bytes, &components).unwrap().info();
    assert_eq!(info.name, "rimlock reference");
}

#[test]
fn unlocks_with_a_key_file_alone() {
    let (bytes, components) = database("scenario-key-file.kdbx");
    assert!(matches!(components.as_slice(), [KeyComponent::KeyFile(_)]));
    assert_eq!(
        unlock(&bytes, &components).unwrap().info().name,
        "rimlock scenario"
    );
}

#[test]
fn unlocks_with_a_password_and_a_key_file() {
    let (bytes, components) = database("scenario-password-key-file.kdbx");
    assert_eq!(components.len(), 2);
    assert!(unlock(&bytes, &components).is_ok());
}

#[test]
fn a_missing_key_file_is_a_wrong_key() {
    let (bytes, mut components) = database("scenario-password-key-file.kdbx");
    components.retain(|component| matches!(component, KeyComponent::Password(_)));
    assert_eq!(unlock_error(&bytes, &components), CoreError::WrongKey);
}

#[test]
fn a_wrong_password_is_a_wrong_key() {
    for file in [
        "scenario-4.1-argon2d.kdbx",
        "scenario-4.0-aes-kdf.kdbx",
        "scenario-3.1.kdbx",
    ] {
        let (bytes, _) = database(file);
        assert_eq!(
            unlock_error(&bytes, &[password_component("not it")]),
            CoreError::WrongKey,
            "{file}"
        );
    }
}

#[test]
fn another_databases_key_file_is_a_wrong_key() {
    let (bytes, _) = database("scenario-key-file.kdbx");
    let other = shared().bytes("scenario-password-key-file.keyx");
    assert_eq!(
        unlock_error(&bytes, &[KeyComponent::KeyFile(SecretBytes::from(other))]),
        CoreError::WrongKey
    );
}

#[test]
fn no_components_are_a_wrong_key() {
    let (bytes, _) = database("scenario-4.1-argon2d.kdbx");
    assert_eq!(unlock_error(&bytes, &[]), CoreError::WrongKey);
}

/// ADR-0011: no key-component provider exists in the MVP.
#[test]
fn any_challenge_response_component_is_a_wrong_key() {
    let (bytes, mut components) = database("scenario-4.1-argon2d.kdbx");
    components.push(KeyComponent::ChallengeResponse(SecretBytes::from(vec![
        7;
        20
    ])));
    assert_eq!(unlock_error(&bytes, &components), CoreError::WrongKey);
}

#[test]
fn a_file_the_header_rejects_fails_the_same_way() {
    let (_, components) = database("scenario-4.1-argon2d.kdbx");
    assert_eq!(
        unlock_error(b"definitely not a database", &components),
        CoreError::UnsupportedFile {
            reason: UnsupportedReason::NotKdbx
        }
    );
}

#[test]
fn a_truncated_payload_is_corrupt() {
    for file in ["scenario-4.1-argon2d.kdbx", "scenario-4.0-aes-kdf.kdbx"] {
        let (bytes, components) = database(file);
        let error = unlock_error(&bytes[..bytes.len() - 100], &components);
        assert!(
            matches!(
                error,
                CoreError::Corrupt {
                    reason: CorruptReason::Truncated | CorruptReason::Payload
                }
            ),
            "{file}: {error:?}"
        );
    }
}

#[test]
fn a_changed_payload_byte_is_corrupt() {
    let (mut bytes, components) = database("scenario-4.1-argon2d.kdbx");
    let last = bytes.len() - 50;
    bytes[last] ^= 1;
    assert_eq!(
        unlock_error(&bytes, &components),
        CoreError::Corrupt {
            reason: CorruptReason::Payload
        }
    );
}

#[test]
fn a_changed_header_byte_fails_the_header_hash() {
    let (mut bytes, components) = database("scenario-4.1-argon2d.kdbx");
    // Inside the master seed (header field 4), which the header parser does not interpret.
    let seed = bytes
        .windows(5)
        .position(|window| window == [4, 32, 0, 0, 0])
        .unwrap()
        + 5;
    bytes[seed] ^= 1;
    assert_eq!(
        unlock_error(&bytes, &components),
        CoreError::Corrupt {
            reason: CorruptReason::HeaderHash
        }
    );
}

#[test]
fn a_changed_3_1_block_is_corrupt() {
    let (mut bytes, components) = database("scenario-3.1.kdbx");
    // The first ciphertext block after the stream start bytes: AES-CBC garbles that block,
    // so the block index, hash or data no longer check out.
    let end_of_header = bytes
        .windows(7)
        .position(|window| window == [0, 4, 0, 13, 10, 13, 10])
        .unwrap()
        + 7;
    bytes[end_of_header + 40] ^= 1;
    assert!(matches!(
        unlock_error(&bytes, &components),
        CoreError::Corrupt { .. }
    ));
}
