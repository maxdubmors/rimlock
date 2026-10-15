//! Secrets inside the Core (`docs/spec/core-api.md` § 8).

use std::fmt;

use zeroize::Zeroizing;

/// Secret bytes: a password as UTF-8, a Key file, a challenge response.
///
/// Zeroed on drop. `Debug` prints a placeholder and there is no `Display`, so a secret cannot
/// end up in an error or a log.
pub struct SecretBytes(Zeroizing<Vec<u8>>);

impl SecretBytes {
    /// The bytes, for the one call that needs them.
    #[must_use]
    pub fn expose(&self) -> &[u8] {
        &self.0
    }
}

impl From<Vec<u8>> for SecretBytes {
    fn from(bytes: Vec<u8>) -> Self {
        Self(Zeroizing::new(bytes))
    }
}

impl fmt::Debug for SecretBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretBytes(..)")
    }
}

/// One part of the Composite key (`docs/spec/core-api.md` § 2).
#[derive(Debug)]
pub enum KeyComponent {
    /// The Master password as UTF-8.
    Password(SecretBytes),
    /// The whole content of a Key file.
    KeyFile(SecretBytes),
    /// A provider's answer to the header's challenge, such as a hardware key's.
    ChallengeResponse(SecretBytes),
}
