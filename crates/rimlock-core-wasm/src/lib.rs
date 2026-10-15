//! `wasm-bindgen` + `tsify` bindings of `rimlock-core` (`docs/spec/engineering.md` § WASM build).
//!
//! Thin by design: no logic lives here, only the mapping onto the Core's API.

use serde::Serialize;
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
