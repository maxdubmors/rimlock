//! What the test Databases contain: the scenario Database and the reference Database.

use super::{Canary, CanaryKind, Clock, Rng};

pub type Uuid = [u8; 16];

pub struct Database {
    pub name: String,
    pub root: Group,
    pub recycle_bin: Option<Uuid>,
}

pub struct Group {
    pub uuid: Uuid,
    pub name: String,
    pub icon: u32,
    pub times: Times,
    pub entries: Vec<Entry>,
    pub groups: Vec<Group>,
}

#[derive(Clone)]
pub struct Entry {
    pub uuid: Uuid,
    pub icon: u32,
    pub tags: Vec<String>,
    pub times: Times,
    pub fields: Vec<Field>,
    /// Older versions, oldest first.
    pub history: Vec<Entry>,
}

#[derive(Clone)]
pub struct Field {
    pub key: String,
    pub value: String,
    pub protected: bool,
}

/// Unix seconds.
#[derive(Clone, Copy)]
pub struct Times {
    pub created: i64,
    pub modified: i64,
    pub expires: Option<i64>,
}

const DAY: i64 = 86_400;
/// Random notes of this length bring the reference Database to about 1 MB.
const NOTES_LENGTH: usize = 260;
const ICON_KEY: u32 = 0;
const ICON_FOLDER: u32 = 48;
const ICON_RECYCLE_BIN: u32 = 43;

/// Builds one Database's contents; every secret it draws is a canary of `database`.
pub struct Builder<'a> {
    rng: &'a mut Rng,
    clock: Clock,
    canaries: &'a mut Vec<Canary>,
    database: String,
}

impl<'a> Builder<'a> {
    pub fn new(
        rng: &'a mut Rng,
        clock: Clock,
        canaries: &'a mut Vec<Canary>,
        database: &str,
    ) -> Self {
        Self {
            rng,
            clock,
            canaries,
            database: database.to_owned(),
        }
    }

    /// A Master password that is also a canary.
    pub fn master_password(&mut self) -> String {
        let value = format!("rmlk-master-{}", self.rng.hex(12));
        self.canary(CanaryKind::MasterPassword, &value);
        value
    }

    /// A small Database that covers what the end-to-end scenarios use.
    pub fn scenario(&mut self) -> Database {
        let mut login = self.entry(
            "Example login",
            "alice",
            "https://example.test/login",
            "Notes for the example login.",
        );
        login = self.with_history(login, 2);

        let mut totp = self.entry("TOTP site", "alice", "https://totp.example.test/", "");
        self.add_totp(&mut totp);

        let mut urls = self.entry("Several URLs", "bob", "https://one.example.test/", "");
        urls.fields
            .push(field("KP2A_URL", "https://two.example.test/", false));
        urls.fields
            .push(field("KP2A_URL_1", "https://three.example.test/", false));

        let mut mail = self.entry(
            "Mail",
            "alice@example.test",
            "https://mail.example.test/",
            "Has custom fields.",
        );
        mail.tags = vec!["mail".to_owned(), "personal".to_owned()];
        mail.fields
            .push(field("Recovery email", "backup@example.test", false));
        let pin = self.secret(CanaryKind::ProtectedField);
        mail.fields.push(field("PIN", &pin, true));

        let mut bank = self.entry(
            "Bank",
            "carol",
            "https://bank.example.test/",
            "Expired a month ago.",
        );
        bank.times.expires = Some(self.clock.now - 30 * DAY);

        let old = self.entry(
            "Old account",
            "dave",
            "https://old.example.test/",
            "In the Recycle Bin.",
        );

        let internet = self.group("Internet", vec![login, totp, urls]);
        let email = self.group("Email", vec![mail]);
        let finance = self.group("Finance", vec![bank]);
        let mut recycle_bin = self.group("Recycle Bin", vec![old]);
        recycle_bin.icon = ICON_RECYCLE_BIN;
        let recycle_bin_uuid = recycle_bin.uuid;

        let mut root = self.group("scenario", Vec::new());
        root.groups = vec![internet, email, finance, recycle_bin];
        Database {
            name: "rimlock scenario".to_owned(),
            root,
            recycle_bin: Some(recycle_bin_uuid),
        }
    }

    /// About 1000 Entries with History in 20 Groups, one with TOTP in each, about 1 MB once encrypted.
    pub fn reference(&mut self) -> Database {
        let mut groups = Vec::new();
        for group in 1..=20 {
            let mut entries = Vec::new();
            for index in 1..=50 {
                let number = (group - 1) * 50 + index;
                let notes = self.rng.alphanumeric(NOTES_LENGTH);
                let entry = self.entry(
                    &format!("Site {number:04}"),
                    &format!("user{number}"),
                    &format!("https://site{number:04}.example.test/login"),
                    &notes,
                );
                let versions = usize::try_from(self.rng.below(7)).unwrap_or_default();
                let mut entry = self.with_history(entry, versions);
                if index == 1 {
                    self.add_totp(&mut entry);
                }
                entries.push(entry);
            }
            groups.push(self.group(&format!("Group {group:02}"), entries));
        }
        let mut recycle_bin = self.group("Recycle Bin", Vec::new());
        recycle_bin.icon = ICON_RECYCLE_BIN;
        let recycle_bin_uuid = recycle_bin.uuid;
        groups.push(recycle_bin);

        let mut root = self.group("reference", Vec::new());
        root.groups = groups;
        Database {
            name: "rimlock reference".to_owned(),
            root,
            recycle_bin: Some(recycle_bin_uuid),
        }
    }

    fn entry(&mut self, title: &str, username: &str, url: &str, notes: &str) -> Entry {
        let password = self.secret(CanaryKind::EntryPassword);
        let created = self.clock.now - DAY * (400 + i64::from(self.rng.below(400)));
        Entry {
            uuid: self.rng.bytes(),
            icon: ICON_KEY,
            tags: Vec::new(),
            times: Times {
                created,
                modified: self.clock.now - DAY * i64::from(self.rng.below(100)),
                expires: None,
            },
            fields: vec![
                field("Title", title, false),
                field("UserName", username, false),
                field("Password", &password, true),
                field("URL", url, false),
                field("Notes", notes, false),
            ],
            history: Vec::new(),
        }
    }

    /// An `otp` field whose seed is a canary.
    fn add_totp(&mut self, entry: &mut Entry) {
        let seed = self.rng.base32(32);
        self.canary(CanaryKind::TotpSeed, &seed);
        entry.fields.push(field(
            "otp",
            &format!(
                "otpauth://totp/rimlock:alice?secret={seed}&period=30&digits=6&issuer=rimlock"
            ),
            true,
        ));
    }

    /// Adds `versions` older versions, each with its own password and notes.
    fn with_history(&mut self, mut entry: Entry, versions: usize) -> Entry {
        let mut modified = entry.times.modified;
        for _ in 0..versions {
            modified -= DAY * (1 + i64::from(self.rng.below(30)));
            let mut version = entry.clone();
            version.history.clear();
            version.times.modified = modified;
            let password = self.secret(CanaryKind::EntryPassword);
            let notes = self.rng.alphanumeric(NOTES_LENGTH);
            for field in &mut version.fields {
                match field.key.as_str() {
                    "Password" => field.value.clone_from(&password),
                    "Notes" => field.value.clone_from(&notes),
                    _ => {}
                }
            }
            entry.history.insert(0, version);
        }
        entry
    }

    fn group(&mut self, name: &str, entries: Vec<Entry>) -> Group {
        let created = self.clock.now - 500 * DAY;
        Group {
            uuid: self.rng.bytes(),
            name: name.to_owned(),
            icon: ICON_FOLDER,
            times: Times {
                created,
                modified: created,
                expires: None,
            },
            entries,
            groups: Vec::new(),
        }
    }

    /// A random secret that is also a canary.
    fn secret(&mut self, kind: CanaryKind) -> String {
        let value = format!("rmlk-{}", self.rng.hex(12));
        self.canary(kind, &value);
        value
    }

    fn canary(&mut self, kind: CanaryKind, value: &str) {
        self.canaries.push(Canary {
            database: self.database.clone(),
            kind,
            value: value.to_owned(),
        });
    }
}

fn field(key: &str, value: &str, protected: bool) -> Field {
    Field {
        key: key.to_owned(),
        value: value.to_owned(),
        protected,
    }
}
