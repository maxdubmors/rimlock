//! Stand-in for `rimlock-core`: pure Rust over keepass-rs, no wasm-bindgen.

use keepass::{Database, DatabaseKey, config::DatabaseVersion};

pub struct Summary {
    pub version: String,
    pub entries: Vec<EntryInfo>,
}

pub struct EntryInfo {
    pub title: String,
    pub username: String,
    pub url: Option<String>,
}

#[derive(Debug)]
pub enum CoreError {
    Open(String),
    Save(String),
    Merge(String),
}

pub fn read_version(file: &[u8]) -> Result<String, CoreError> {
    let version = Database::get_version(&mut &file[..]).map_err(|e| CoreError::Open(e.to_string()))?;
    Ok(version.to_string())
}

pub fn create_sample(password: &str) -> Result<Vec<u8>, CoreError> {
    let mut db = Database::new();
    db.config.version = DatabaseVersion::KDB4(1);
    db.root_mut().add_entry().edit(|e| {
        e.set_unprotected("Title", "Example");
        e.set_unprotected("UserName", "alice");
        e.set_unprotected("URL", "https://example.com/login");
        e.set_protected("Password", "correct horse battery staple");
    });
    let mut out = Vec::new();
    db.save(&mut out, DatabaseKey::new().with_password(password))
        .map_err(|e| CoreError::Save(e.to_string()))?;
    Ok(out)
}

pub fn summarize(file: &[u8], password: &str) -> Result<Summary, CoreError> {
    let db = open(file, password)?;
    let entries = db
        .iter_all_entries()
        .map(|e| EntryInfo {
            title: e.get_title().unwrap_or_default().to_owned(),
            username: e.get_username().unwrap_or_default().to_owned(),
            url: e.get_url().map(str::to_owned),
        })
        .collect();
    Ok(Summary { version: db.config.version.to_string(), entries })
}

pub fn merge(ours: &[u8], theirs: &[u8], password: &str) -> Result<Vec<u8>, CoreError> {
    let mut a = open(ours, password)?;
    let b = open(theirs, password)?;
    a.merge(&b).map_err(|e| CoreError::Merge(e.to_string()))?;
    let mut out = Vec::new();
    a.save(&mut out, DatabaseKey::new().with_password(password))
        .map_err(|e| CoreError::Save(e.to_string()))?;
    Ok(out)
}

fn open(file: &[u8], password: &str) -> Result<Database, CoreError> {
    Database::parse(file, DatabaseKey::new().with_password(password)).map_err(|e| CoreError::Open(e.to_string()))
}
