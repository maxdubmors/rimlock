//! A field or variant the bindings document carries the Core's doc text for the same member, so
//! the generated `.d.ts` cannot drift from the Core (`docs/spec/engineering.md` § WASM build).

#![cfg(test)]

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// Doc comments of the members of every `pub struct` and `pub enum`, keyed `Type.member` or
/// `Type.Variant.field`. Relies on rustfmt's layout: types at column 0, four-space indents.
fn member_docs(source: &str) -> BTreeMap<String, String> {
    let mut docs = BTreeMap::new();
    let (mut type_name, mut variant) = (None::<String>, None::<String>);
    let mut pending: Vec<&str> = Vec::new();
    for line in source.lines() {
        if let Some(rest) = line
            .strip_prefix("pub struct ")
            .or_else(|| line.strip_prefix("pub enum "))
            .filter(|_| line.ends_with('{'))
        {
            type_name = Some(rest.trim_end_matches('{').trim().to_owned());
            pending.clear();
            continue;
        }
        let Some(current) = &type_name else { continue };
        if line == "}" {
            type_name = None;
            continue;
        }
        let trimmed = line.trim_start();
        let depth = (line.len() - trimmed.len()) / 4;
        if let Some(doc) = trimmed.strip_prefix("///") {
            pending.push(doc.trim());
            continue;
        }
        if trimmed.starts_with("#[") {
            continue;
        }
        if depth == 1 && trimmed.starts_with('}') {
            variant = None;
            continue;
        }
        let name: String = trimmed
            .trim_start_matches("pub ")
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if !name.is_empty() {
            let key = match (depth, &variant) {
                (2, Some(variant)) => format!("{current}.{variant}.{name}"),
                _ => format!("{current}.{name}"),
            };
            if !pending.is_empty() {
                docs.insert(key, pending.join(" "));
            }
            if depth == 1 && trimmed.ends_with('{') {
                variant = Some(name);
            }
        }
        pending.clear();
    }
    docs
}

fn crate_docs(src: &Path) -> BTreeMap<String, String> {
    let mut docs = BTreeMap::new();
    for entry in fs::read_dir(src).unwrap_or_else(|e| panic!("reading {}: {e}", src.display())) {
        let path = entry.expect("a directory entry").path();
        if path.extension().is_some_and(|extension| extension == "rs") {
            let source = fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
            docs.extend(member_docs(&source));
        }
    }
    docs
}

#[test]
fn a_documented_binding_member_has_the_cores_doc_text() {
    let crates = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let core = crate_docs(&crates.join("rimlock-core/src"));
    let bindings = crate_docs(&crates.join("rimlock-core-wasm/src"));
    let shared: Vec<_> = bindings
        .iter()
        .filter_map(|(member, doc)| Some((member, doc, core.get(member)?)))
        .collect();
    assert!(
        shared
            .iter()
            .any(|(member, _, _)| *member == "HeaderInfo.challenge"),
        "the parser no longer finds HeaderInfo.challenge in both crates"
    );
    for (member, binding_doc, core_doc) in shared {
        assert_eq!(binding_doc, core_doc, "{member}: the binding's doc differs");
    }
}
