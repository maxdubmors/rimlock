//! Stand-in for `rimlock-core-wasm`: thin wasm-bindgen + tsify bindings.

use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummary {
    pub title: String,
    pub username: String,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSummary {
    pub version: String,
    pub entries: Vec<EntrySummary>,
}

#[derive(Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum CoreError {
    Open(String),
    Save(String),
    Merge(String),
    Boundary(String),
}

impl From<rimlock_core::CoreError> for CoreError {
    fn from(e: rimlock_core::CoreError) -> Self {
        match e {
            rimlock_core::CoreError::Open(m) => Self::Open(m),
            rimlock_core::CoreError::Save(m) => Self::Save(m),
            rimlock_core::CoreError::Merge(m) => Self::Merge(m),
        }
    }
}

type CoreResult<T> = Result<T, JsValue>;

fn fail(e: impl Into<CoreError>) -> JsValue {
    match e.into().into_ts() {
        Ok(ts) => ts.into(),
        Err(err) => JsValue::from_str(&err.to_string()),
    }
}

fn boundary(e: impl ToString) -> JsValue {
    fail(CoreError::Boundary(e.to_string()))
}

#[wasm_bindgen(js_name = readVersion)]
pub fn read_version(file: &[u8]) -> CoreResult<String> {
    rimlock_core::read_version(file).map_err(fail)
}

#[wasm_bindgen(js_name = createSample)]
pub fn create_sample(password: &str) -> CoreResult<Vec<u8>> {
    rimlock_core::create_sample(password).map_err(fail)
}

#[wasm_bindgen]
pub fn summarize(file: &[u8], password: &str) -> CoreResult<Ts<DatabaseSummary>> {
    let s = rimlock_core::summarize(file, password).map_err(fail)?;
    let summary = DatabaseSummary {
        version: s.version,
        entries: s
            .entries
            .into_iter()
            .map(|e| EntrySummary { title: e.title, username: e.username, url: e.url })
            .collect(),
    };
    summary.into_ts().map_err(boundary)
}

#[wasm_bindgen]
pub fn merge(ours: &[u8], theirs: &[u8], password: &str) -> CoreResult<Vec<u8>> {
    rimlock_core::merge(ours, theirs, password).map_err(fail)
}

/// Panic paths: the panic `Location` embeds this file's path in the `.wasm`,
/// which is exactly what `--remap-path-prefix` must normalise.
#[wasm_bindgen(js_name = entryTitleAt)]
pub fn entry_title_at(summary: Ts<DatabaseSummary>, index: usize) -> CoreResult<String> {
    let summary = summary.to_rust().map_err(boundary)?;
    Ok(summary.entries[index].title.clone())
}

#[wasm_bindgen(js_name = panicWith)]
pub fn panic_with(message: &str) {
    panic!("rimlock-core-wasm: {message}");
}
