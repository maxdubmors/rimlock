//! Secrets never print their content (`docs/spec/core-api.md` § 8).

use rimlock_core::{CachedKey, Core, KeyComponent, SecretBytes, TransformedKey};

use crate::fixtures::database;

const CANARY: &str = "rmlk-secret-canary";

/// `Debug` shows neither the text nor the bytes.
fn assert_hidden(printed: &str) {
    assert!(!printed.contains(CANARY), "{printed}");
    let bytes = format!("{:?}", CANARY.as_bytes());
    assert!(!printed.contains(&bytes[1..bytes.len() - 1]), "{printed}");
}

#[test]
fn secret_bytes_do_not_print_their_content() {
    assert_hidden(&format!(
        "{:?}",
        SecretBytes::from(CANARY.as_bytes().to_vec())
    ));
    assert_hidden(&format!(
        "{:#?}",
        SecretBytes::from(CANARY.as_bytes().to_vec())
    ));
}

#[test]
fn key_components_do_not_print_their_content() {
    for component in [
        KeyComponent::Password(SecretBytes::from(CANARY.as_bytes().to_vec())),
        KeyComponent::KeyFile(SecretBytes::from(CANARY.as_bytes().to_vec())),
        KeyComponent::ChallengeResponse(SecretBytes::from(CANARY.as_bytes().to_vec())),
    ] {
        assert_hidden(&format!("{component:?}"));
    }
}

#[test]
fn key_material_does_not_print_its_content() {
    let mut key = [0; 32];
    key[..CANARY.len()].copy_from_slice(CANARY.as_bytes());
    assert_hidden(&format!("{:?}", TransformedKey::from(key)));
    assert_hidden(&format!(
        "{:?}",
        CachedKey::from(CANARY.as_bytes().to_vec())
    ));
}

#[test]
fn a_wrong_key_error_does_not_carry_the_password() {
    let (bytes, _) = database("scenario.kdbx");
    let password = KeyComponent::Password(SecretBytes::from(CANARY.as_bytes().to_vec()));
    let Err(error) = Core::default().unlock(&bytes, &[password]) else {
        panic!("unlocked with the wrong password");
    };
    assert_hidden(&format!("{error:?}"));
}
