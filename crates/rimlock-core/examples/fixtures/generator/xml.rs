//! The inner XML document, as KeePass writes it.

use std::fmt::Write as _;

use base64::{Engine as _, engine::general_purpose::STANDARD};

use super::contents::{Database, Entry, Group, Times, Uuid};

/// Seconds from 0001-01-01 to 1970-01-01: KDBX 4 stores times from the former.
const UNIX_EPOCH_IN_KDBX4: i64 = 62_135_596_800;

/// How the document writes times and whether `Meta` carries the KDBX 3.1 header hash.
#[derive(Clone, Copy)]
pub enum Dialect<'a> {
    Kdbx3 { header_hash: &'a [u8] },
    Kdbx4,
}

/// Serialises `database`; `protect` encrypts each protected value in document order.
pub fn document(
    database: &Database,
    dialect: Dialect<'_>,
    protect: &mut dyn FnMut(&[u8]) -> Vec<u8>,
) -> String {
    let mut writer = Writer {
        out: String::new(),
        dialect,
        protect,
    };
    writer.database(database);
    writer.out
}

struct Writer<'a, 'p> {
    out: String,
    dialect: Dialect<'a>,
    protect: &'p mut dyn FnMut(&[u8]) -> Vec<u8>,
}

impl Writer<'_, '_> {
    fn database(&mut self, database: &Database) {
        self.out
            .push_str("<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\"?>\n<KeePassFile>\n<Meta>\n");
        self.text("Generator", "rimlock fixtures");
        if let Dialect::Kdbx3 { header_hash } = self.dialect {
            self.text("HeaderHash", &STANDARD.encode(header_hash));
        }
        self.text("DatabaseName", &database.name);
        let changed = database.root.times.created;
        self.time("DatabaseNameChanged", changed);
        self.out.push_str(
            "<MemoryProtection>\n<ProtectTitle>False</ProtectTitle>\n<ProtectUserName>False</ProtectUserName>\n\
             <ProtectPassword>True</ProtectPassword>\n<ProtectURL>False</ProtectURL>\n\
             <ProtectNotes>False</ProtectNotes>\n</MemoryProtection>\n",
        );
        self.text(
            "RecycleBinEnabled",
            bool_text(database.recycle_bin.is_some()),
        );
        self.uuid("RecycleBinUUID", &database.recycle_bin.unwrap_or_default());
        self.time("RecycleBinChanged", changed);
        self.text("HistoryMaxItems", "10");
        self.text("HistoryMaxSize", "6291456");
        self.out.push_str("</Meta>\n<Root>\n");
        self.group(&database.root);
        self.out
            .push_str("<DeletedObjects />\n</Root>\n</KeePassFile>\n");
    }

    fn group(&mut self, group: &Group) {
        self.out.push_str("<Group>\n");
        self.uuid("UUID", &group.uuid);
        self.text("Name", &group.name);
        self.text("IconID", &group.icon.to_string());
        self.times(group.times);
        self.text("IsExpanded", "True");
        for entry in &group.entries {
            self.entry(entry);
        }
        for child in &group.groups {
            self.group(child);
        }
        self.out.push_str("</Group>\n");
    }

    fn entry(&mut self, entry: &Entry) {
        self.out.push_str("<Entry>\n");
        self.uuid("UUID", &entry.uuid);
        self.text("IconID", &entry.icon.to_string());
        self.text("Tags", &entry.tags.join(";"));
        self.times(entry.times);
        for field in &entry.fields {
            self.out.push_str("<String>\n");
            self.text("Key", &field.key);
            if field.protected {
                let encrypted = STANDARD.encode((self.protect)(field.value.as_bytes()));
                let _ = writeln!(self.out, "<Value Protected=\"True\">{encrypted}</Value>");
            } else {
                self.text("Value", &field.value);
            }
            self.out.push_str("</String>\n");
        }
        if !entry.history.is_empty() {
            self.out.push_str("<History>\n");
            for version in &entry.history {
                self.entry(version);
            }
            self.out.push_str("</History>\n");
        }
        self.out.push_str("</Entry>\n");
    }

    fn times(&mut self, times: Times) {
        self.out.push_str("<Times>\n");
        self.time("CreationTime", times.created);
        self.time("LastModificationTime", times.modified);
        self.time("LastAccessTime", times.modified);
        self.time("ExpiryTime", times.expires.unwrap_or(times.created));
        self.text("Expires", bool_text(times.expires.is_some()));
        self.text("UsageCount", "0");
        self.time("LocationChanged", times.created);
        self.out.push_str("</Times>\n");
    }

    fn time(&mut self, tag: &str, unix: i64) {
        let value = match self.dialect {
            Dialect::Kdbx3 { .. } => iso8601(unix),
            Dialect::Kdbx4 => STANDARD.encode((unix + UNIX_EPOCH_IN_KDBX4).to_le_bytes()),
        };
        self.text(tag, &value);
    }

    fn uuid(&mut self, tag: &str, uuid: &Uuid) {
        self.text(tag, &STANDARD.encode(uuid));
    }

    fn text(&mut self, tag: &str, value: &str) {
        if value.is_empty() {
            let _ = writeln!(self.out, "<{tag} />");
            return;
        }
        let _ = write!(self.out, "<{tag}>");
        for char in value.chars() {
            match char {
                '&' => self.out.push_str("&amp;"),
                '<' => self.out.push_str("&lt;"),
                '>' => self.out.push_str("&gt;"),
                '"' => self.out.push_str("&quot;"),
                _ => self.out.push(char),
            }
        }
        let _ = writeln!(self.out, "</{tag}>");
    }
}

fn bool_text(value: bool) -> &'static str {
    if value { "True" } else { "False" }
}

/// `YYYY-MM-DDThh:mm:ssZ`, the KDBX 3.1 time format (civil-from-days, proleptic Gregorian).
fn iso8601(unix: i64) -> String {
    let (days, seconds) = (unix.div_euclid(86_400), unix.rem_euclid(86_400));
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        seconds / 3600,
        seconds % 3600 / 60,
        seconds % 60
    )
}
