//! `wasm-bindgen` + `tsify` bindings of `rimlock-core` (`docs/spec/engineering.md` § WASM build).
//!
//! Thin by design: no logic lives here, only the mapping onto the Core's API. A Core call throws
//! every failure as a `CoreError` value, which `CoreClient` catches and returns as a `CoreResult`;
//! only a broken binding throws anything else.

use rimlock_core::SecretBytes;
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

/// What the Core says about itself (`docs/spec/core-api.md` § 3).
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct CoreInfo {
    pub version: String,
}

/// The Core's version and build facts; holds no state.
///
/// # Errors
///
/// Only if `CoreInfo` cannot be converted to a JS value, which would be a bug in the bindings.
#[wasm_bindgen(js_name = coreInfo)]
pub fn core_info() -> Result<Ts<CoreInfo>, JsError> {
    let info = CoreInfo {
        version: rimlock_core::version().to_owned(),
    };
    Ok(info.into_ts()?)
}

/// The KDBX version of a file (`docs/spec/core-api.md` § 2).
#[derive(Serialize, Tsify)]
pub enum FormatVersion {
    #[serde(rename = "3.1")]
    V3_1,
    #[serde(rename = "4.0")]
    V4_0,
    #[serde(rename = "4.1")]
    V4_1,
}

impl From<rimlock_core::FormatVersion> for FormatVersion {
    fn from(version: rimlock_core::FormatVersion) -> Self {
        match version {
            rimlock_core::FormatVersion::V3_1 => Self::V3_1,
            rimlock_core::FormatVersion::V4_0 => Self::V4_0,
            rimlock_core::FormatVersion::V4_1 => Self::V4_1,
        }
    }
}

/// The KDF and the parameters a settings screen would show (`docs/spec/core-api.md` § 2).
#[derive(Serialize, Tsify)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
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

impl From<rimlock_core::KdfParameters> for KdfParameters {
    fn from(kdf: rimlock_core::KdfParameters) -> Self {
        match kdf {
            rimlock_core::KdfParameters::Argon2d {
                iterations,
                memory_bytes,
                parallelism,
            } => Self::Argon2d {
                iterations,
                memory_bytes,
                parallelism,
            },
            rimlock_core::KdfParameters::Argon2id {
                iterations,
                memory_bytes,
                parallelism,
            } => Self::Argon2id {
                iterations,
                memory_bytes,
                parallelism,
            },
            rimlock_core::KdfParameters::AesKdf { rounds } => Self::AesKdf { rounds },
        }
    }
}

/// What `readHeader` returns (`docs/spec/core-api.md` § 2).
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct HeaderInfo {
    pub format_version: FormatVersion,
    pub kdf: KdfParameters,
    /// The KDF seed (in KDBX 3.1, the transform seed): what a challenge-response provider
    /// answers for KDBX 4.x. Challenge-response is not supported for KDBX 3.1 (#80).
    #[serde(with = "serde_bytes")]
    #[tsify(type = "Uint8Array")]
    pub challenge: Vec<u8>,
}

/// One part of the Composite key (`docs/spec/core-api.md` § 2). Secrets arrive as bytes, which
/// the caller wipes after the call.
#[derive(Deserialize, Tsify)]
#[serde(tag = "kind")]
pub enum KeyComponent {
    /// The Master password as UTF-8.
    Password {
        #[serde(with = "serde_bytes")]
        #[tsify(type = "Uint8Array")]
        value: Vec<u8>,
    },
    KeyFile {
        #[serde(with = "serde_bytes")]
        #[tsify(type = "Uint8Array")]
        bytes: Vec<u8>,
    },
    ChallengeResponse {
        #[serde(with = "serde_bytes")]
        #[tsify(type = "Uint8Array")]
        response: Vec<u8>,
    },
}

impl From<KeyComponent> for rimlock_core::KeyComponent {
    fn from(component: KeyComponent) -> Self {
        match component {
            KeyComponent::Password { value } => Self::Password(SecretBytes::from(value)),
            KeyComponent::KeyFile { bytes } => Self::KeyFile(SecretBytes::from(bytes)),
            KeyComponent::ChallengeResponse { response } => {
                Self::ChallengeResponse(SecretBytes::from(response))
            }
        }
    }
}

/// What `info()` returns (`docs/spec/core-api.md` § 4).
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    pub root_group: String,
    pub recycle_bin_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub recycle_bin: Option<String>,
    pub format_version: FormatVersion,
}

/// Every way a Core call fails (`docs/spec/core-api.md` § 8): the value the bindings throw.
#[derive(Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum CoreError {
    WrongKey,
    UnsupportedFile {
        reason: String,
    },
    Corrupt {
        reason: String,
    },
    CachedKeyStale,
    ChallengeResponseRequired {
        #[serde(with = "serde_bytes")]
        #[tsify(type = "Uint8Array")]
        challenge: Vec<u8>,
    },
    RemoteKeyChanged,
    NotFound {
        uuid: String,
    },
    EntryChanged {
        uuid: String,
    },
    InvalidChange {
        reason: String,
    },
    VerifyFailed,
    Internal,
}

impl From<rimlock_core::CoreError> for CoreError {
    fn from(error: rimlock_core::CoreError) -> Self {
        use rimlock_core::CoreError as Core;
        match error {
            Core::WrongKey => Self::WrongKey,
            Core::UnsupportedFile { reason } => Self::UnsupportedFile {
                reason: reason.code().to_owned(),
            },
            Core::Corrupt { reason } => Self::Corrupt {
                reason: reason.code().to_owned(),
            },
            Core::CachedKeyStale => Self::CachedKeyStale,
            Core::ChallengeResponseRequired { challenge } => {
                Self::ChallengeResponseRequired { challenge }
            }
            Core::RemoteKeyChanged => Self::RemoteKeyChanged,
            Core::NotFound { uuid } => Self::NotFound {
                uuid: uuid.to_string(),
            },
            Core::EntryChanged { uuid } => Self::EntryChanged {
                uuid: uuid.to_string(),
            },
            Core::InvalidChange { reason } => Self::InvalidChange {
                reason: reason.code().to_owned(),
            },
            Core::VerifyFailed => Self::VerifyFailed,
            Core::Internal => Self::Internal,
        }
    }
}

/// A Core result as JS: a value that does not convert is a bug in the bindings, thrown as `Internal`.
fn to_js<T: Tsify + Serialize>(value: &T) -> Result<Ts<T>, JsValue> {
    value
        .into_ts()
        .map_err(|_| thrown(rimlock_core::CoreError::Internal))
}

/// The JS value a failure throws: the `CoreError`, or, if a binding is broken, a plain error.
fn thrown(error: rimlock_core::CoreError) -> JsValue {
    CoreError::from(error).into_ts().map_or_else(
        |_| JsError::new("CoreError serialisation failed").into(),
        JsValue::from,
    )
}

/// The KDBX version, the KDF and the challenge of a file, without a key.
///
/// # Errors
///
/// Throws `UnsupportedFile` or `Corrupt`.
#[wasm_bindgen(js_name = readHeader)]
pub fn read_header(bytes: &[u8]) -> Result<Ts<HeaderInfo>, JsValue> {
    let header = rimlock_core::read_header(bytes).map_err(thrown)?;
    to_js(&HeaderInfo {
        format_version: header.format_version.into(),
        kdf: header.kdf.into(),
        challenge: header.challenge,
    })
}

/// Decrypts a `.kdbx` with the given Composite key; runs the KDF.
///
/// # Errors
///
/// Throws `WrongKey` (also for any `ChallengeResponse` component), `UnsupportedFile` or
/// `Corrupt`; `Internal` for components that do not match `KeyComponent`, or for a second
/// password or Key file.
#[wasm_bindgen]
pub fn unlock(
    bytes: &[u8],
    components: Vec<Ts<KeyComponent>>,
) -> Result<UnlockedDatabase, JsValue> {
    let components = components
        .into_iter()
        .map(|component| component.to_rust().map(rimlock_core::KeyComponent::from))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| thrown(rimlock_core::CoreError::Internal))?;
    let database = rimlock_core::unlock(bytes, &components).map_err(thrown)?;
    Ok(UnlockedDatabase(database))
}

/// One Unlocked Database, held by the background alone (`docs/spec/core-api.md` § 4).
#[wasm_bindgen]
pub struct UnlockedDatabase(rimlock_core::UnlockedDatabase);

#[wasm_bindgen]
impl UnlockedDatabase {
    /// The Database's name, root Group, Recycle Bin and format version.
    ///
    /// # Errors
    ///
    /// Only if `DatabaseInfo` cannot be converted to a JS value, which would be a bug in the bindings.
    pub fn info(&self) -> Result<Ts<DatabaseInfo>, JsValue> {
        let info = self.0.info();
        to_js(&DatabaseInfo {
            name: info.name,
            root_group: info.root_group.to_string(),
            recycle_bin_enabled: info.recycle_bin_enabled,
            recycle_bin: info.recycle_bin.map(|uuid| uuid.to_string()),
            format_version: info.format_version.into(),
        })
    }
}
