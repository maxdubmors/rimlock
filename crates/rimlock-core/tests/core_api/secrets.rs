//! Secrets never print their content (`docs/spec/core-api.md` § 8).

use rimlock_core::{KeyComponent, SecretBytes, unlock};

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
fn a_wrong_key_error_does_not_carry_the_password() {
    let (bytes, _) = database("scenario.kdbx");
    let password = KeyComponent::Password(SecretBytes::from(CANARY.as_bytes().to_vec()));
    let Err(error) = unlock(&bytes, &[password]) else {
        panic!("unlocked with the wrong password");
    };
    assert_hidden(&format!("{error:?}"));
}
