# KDBX 4.1 support across KeePass clients

Research for [#20](https://github.com/maxdubmors/rimlock/issues/20). Date: 2026-10-06. Feeds the KDBX core decision in #11. Background: [KDBX core libraries](https://github.com/maxdubmors/rimlock/blob/research/kdbx-core-libraries/docs/research/kdbx-core-libraries.md) found that keepass-rs saves only KDBX 4.1, so a 4.0 (or 3.1) file gets upgraded to 4.1 the first time the Extension saves it.

## Question

Do current releases of the main KeePass clients (KeePassXC, Strongbox, KeePassDX, KeePass 2.x, Keepass2Android, KeePassium) open and save KDBX 4.1 files without data loss? Do any of them downgrade, refuse, or warn? Is it acceptable for keepass-rs to upgrade 4.0 files to 4.1 without asking?

For each client this doc answers: does it read 4.1, does it write 4.1, what happens to the 4.1-only data when it saves, and since which version.

Sources examined (all primary):

- KDBX 4.1 spec page on keepass.info, Wayback snapshot 2026-06-29 [Spec41].
- KeePass 2.61.1 source zip (latest release, 2026-05-01; SHA-256 `711bd9ec…c13a`) [KP]. Also the KeePass 2.47 source zip, the last release before 4.1 [KP247].
- KeePassXC `develop` @ `9e0f57a` (2026-09-22). The latest stable is 2.7.12 (2026-03-10) and the latest pre-release is 2.8.0-beta1 [KX-changelog].
- Strongbox @ `c70fc7b` (2026-07-17, commit "1.65.0").
- KeePassDX @ `2db52c5` (2026-09-25), `versionName` 4.5.5, which is the latest release.
- Keepass2Android @ `76d8502` (2026-10-05). The latest release is v1.15-r4 (2026-09-14).
- KeePassium @ `e651df4` (2026-05-23). The latest changelog entry is 2.6.173.

Nothing was run for this doc. Every finding comes from reading source code and changelogs.

### What KDBX 4.1 adds

KeePass 2.48 introduced KDBX 4.1. It adds exactly five things to the inner XML. The outer header format is unchanged [Spec41]:

1. `Tags` on `Group`.
2. `QualityCheck` (bool) on `Entry`.
3. `PreviousParentGroup` (UUID) on `Entry` and `Group`.
4. `Name` and `LastModificationTime` on `Meta/CustomIcons/Icon`. Deleting a custom icon also creates a `DeletedObject`.
5. `LastModificationTime` on `Meta/CustomData/Item`.

`PublicCustomData` (the unencrypted header dictionary) is a **KDBX 4.0** feature, not a 4.1 one. KeePassXC [KX-writer-ver] and Keepass2Android [K2A-minver] both treat it as a reason to write 4.0.

## Summary

| Client (current release) | Reads 4.1 | Writes 4.1 | Version it saves a 4.1 file as | What happens to the 4.1 data on save | 4.1 support since |
|---|---|---|---|---|---|
| **KeePass 2.x** 2.61.1 | yes | yes | **Recomputed** each save: 4.1 only if the database has group tags, `QualityCheck=false`, a named or timestamped custom icon, or a timestamped Meta CustomData item. **Otherwise 4.0.** | When it saves as 4.0: `PreviousParentGroup` and CustomData timestamps are **dropped** | 2.48 (2021) |
| **KeePassXC** 2.7.12 / 2.8.0-beta1 | yes | yes | **Kept at 4.1.** The saved version is never lower than the version that was opened. | All kept | 2.7.0 (2022-03-21) |
| **Strongbox** 1.65.0 | yes | yes | **Kept.** The header version read from the file is written back. | All kept. Unknown XML is kept too. | Opens 4.1 headers since 1.47.4 (2020-04). 4.1 elements modelled since iOS 1.52.16 / macOS 1.15.12 (2021-05). |
| **KeePassDX** 4.5.5 | yes | yes | **Recomputed** each save, using the same rule as KeePass. It can also go down to **3.1** (AES-KDF and no custom data). | `PreviousParentGroup` is **dropped** when it saves below 4.1 | 2.10.0 (2021-05-07) |
| **Keepass2Android** v1.15-r4 | yes | yes | **Recomputed** each save, using the same rule as KeePass, plus 3.1 when possible. The "never below what was read" guard does not run on the normal save path (see below). | `PreviousParentGroup` and CustomData timestamps are **dropped** when it saves below 4.1 | 1.09a (2021-08) |
| **KeePassium** 2.6.173 | yes | yes | **Kept.** It only upgrades (4.0 → 4.1 without a prompt when a 4.1 feature is used) and never downgrades. | All kept | 1.24.87 (2021-05-06) |

**Answer.** Every current release of all six clients opens and saves KDBX 4.1. None of them refuses a 4.1 file or warns about one. KeePass, KeePassXC and Keepass2Android warn or refuse only for minor versions **above** 4.1. Strongbox refuses those too.

So upgrading to 4.1 is safe for anyone running a client released after mid-2021 (2022 for KeePassXC). The side effects to expect:

- KeePass 2.x, KeePassDX and Keepass2Android will often save the file back as 4.0, and KeePassDX and Keepass2Android sometimes as 3.1. The version will flip back and forth depending on which client saved last. This is harmless to rimlock, because keepass-rs reads 3.1, 4.0 and 4.1. But those clients drop `PreviousParentGroup` when they write below 4.1.
- 4.1 files are already common. KeePassXC sets `PreviousParentGroup` whenever an entry or group is moved, including into the Recycle Bin, and that alone makes it save 4.1 from then on [KX-entry-move] [KX-writer-ver].

## Findings

### KeePass 2.x (reference implementation)

- **Reads 4.1.** `FileVersion32 = 0x00040001`. A file with a higher **minor** version triggers a confirmation callback (`g_fConfirmOpenUnkVer`), and a higher **major** version is refused [KP-read]. The doc comment maps each KeePass version to a format version: "2.35 - 4.0, 2.48 - 4.1" [KP-ver].
- **Writes the lowest version that fits the data.** `GetMinKdbxVersion()` returns 4.1 only for group tags, entries with `QualityCheck` disabled, custom icons with a name or `LastModificationTime`, or Meta CustomData items with a `LastModificationTime`. Otherwise it returns 4.0 [KP-minver]. It ignores the version the file was opened with. The spec states this policy directly: during the "Migration Phase" KeePass saves 4.1 only under those conditions, "The existence of a previous parent group reference does not enforce KDBX 4.1 (compatibility with KeePass ports is currently considered to be more important)", and "As soon as all major KeePass ports support KDBX 4.1, KeePass will always save in this format" [Spec41]. As of 2.61.1 that switch has not happened.
- **What it drops on a 4.0 save.** The writer gates `PreviousParentGroup` and group `Tags` [KP-write-group], `QualityCheck` and entry `PreviousParentGroup` [KP-write-entry], every CustomData item's `LastModificationTime` [KP-write-cd], and icon `Name`/`LastModificationTime` [KP-write-icon] on `m_uFileVersion >= FileVersion32_4_1`. Only `PreviousParentGroup` and the timestamps on Group/Entry CustomData can actually be lost this way. The other features force 4.1 themselves.
- **Meta CustomData timestamps are automatic.** "The last modification times are saved automatically (by the StringDictionaryEx class)" [Spec41]. So a database where KeePass or a plugin has set a database-level CustomData item will be saved as 4.1 by KeePass itself.
- **Older KeePass (< 2.48).** KeePass 2.47 has `FileVersion32 = 0x00040000` and rejects only a higher *major* version [KP247]. It opens 4.1 files without a warning and skips the elements it doesn't know.

### KeePassXC

- **Reads 4.1.** `FILE_VERSION_MAX = FILE_VERSION_4_1` [KX-ver]. The reader refuses only a higher *major* version [KX-reader]. A minor version above 4.1 opens, but with a "Database Version Mismatch" warning that "saving any changes may incur data loss" [KX-mismatch] [KX-db-mismatch].
- **Never downgrades.** `kdbxVersionRequired(db)` starts from `db->formatVersion()` (the version read from disk) unless `ignoreCurrent` is set. It then raises the version for 4.0 features (non-AES-KDF, `PublicCustomData`, any CustomData) and 4.1 features (group tags, `PreviousParentGroup`, `QualityCheck` excluded from reports, named or timestamped icons) [KX-writer-ver]. `writeDatabase` saves with that version [KX-write]. A 4.1 file therefore stays 4.1.
- **Writes every 4.1 element** when the version is ≥ 4.1: icon `Name` and `LastModificationTime` [KX-xml-icon], Meta-only CustomData item `LastModificationTime` [KX-xml-cd], group `PreviousParentGroup` [KX-xml-group], entry `QualityCheck` and `PreviousParentGroup` [KX-xml-entry].
- **It generates 4.1 data itself.** `Entry::setGroup(..., trackPrevious)` records the previous parent whenever an entry is moved within a database [KX-entry-move]. That makes the next save 4.1. The kdbx-core-libraries research saw exactly this happen with a KeePassXC CLI 2.7.12 fixture.
- **Since 2.7.0** (2022-03-21): "Implement KDBX 4.1 [#7114]" [KX-changelog].
- **Older KeePassXC (2.6.x).** 2.6.6 masks out the minor version before its version check [KX266]. So it opens 4.1 without a warning, skips the 4.1 elements, and writes the file back as 4.0.

### Strongbox

- **Reads 4.1, and nothing higher.** `kKdbx4MaximumAcceptableMinorVersionNumber = 1` [SB-gate]. The check fails if `header.minor > minorVersion` [SB-gate-cmp], so a 4.2 file would be **refused**.
- **History.** In Feb 2020 the constant was `kKdbx4MinorVersionNumber = 0`, which meant 4.1 was refused [SB-2020-02]. Version 1.47.4 (2020-04) raised it to 1, with the comment "KeeWeb had originally set a few of its files to 4.1 … accept them" [SB-2020-11]. The 4.1 element names `QualityCheck` and `PreviousParentGroup` first appear in the iOS 1.52.16 / macOS 1.15.12 commit (2021-05-10) [SB-consts-2021].
- **Keeps the file's version.** The version read from the file goes into `metadata.version` [SB-load], and on save `serializationData.fileVersion = database.meta.version` [SB-save]. New databases default to `"4.0"` [SB-default]. A user can change the sub-version in encryption settings [SB-settings].
- **Writes the 4.1 elements whatever the header version is**, with no version gate: entry `QualityCheck` and `PreviousParentGroup` [SB-entry], group `Tags` and `PreviousParentGroup` [SB-group], CustomData item `LastModificationTime` [SB-cd], icon `Name` and `LastModificationTime` [SB-icon]. It also writes back unknown child elements it read ("unmanaged children") [SB-unmanaged]. Of the six clients, Strongbox loses the least on a round trip.

### KeePassDX

- **Reads 4.1.** `validVersion` compares only the major part (`FILE_VERSION_CRITICAL_MASK`) [DX-valid]. There is no warning for a newer minor version.
- **Recomputes the version on every save.** `SaveDatabaseRunnable.onActionRun()` calls `database.checkVersion()` [DX-save-run], which sets `kdbxVersion = getMinKdbxVersion()` [DX-check]. The output header is also built with `version = databaseV4.getMinKdbxVersion()` [DX-header] [DX-out-header]. `getMinKdbxVersion()` cites the keepass.info pages and mirrors KeePass's 4.1 rule: group tags, `QualityCheck` off, named or timestamped icons, timestamped Meta CustomData. It then returns 4.0 for a non-AES KDF or any CustomData, and **3.1 otherwise** [DX-minver]. A 4.1 file that has only `PreviousParentGroup` is saved as 4.0. An AES-KDF file with no CustomData is saved as 3.1.
- **What it drops.** `PreviousParentGroup` is written only when `version >= FILE_VERSION_41` [DX-ppg]. CustomData item `LastModificationTime` is written with no version gate [DX-cd].
- **Since 2.10.0** (2021-05-07): "Manage new database format 4.1 #956" [DX-changelog].

### Keepass2Android

- **Reads 4.1.** It uses a fork of KeePassLib (`src/KeePassLib2Android`) with `FileVersion32 = 0x00040001`. Like KeePass 2.47, it refuses only a higher major version and has no prompt for a newer minor version [K2A-read].
- **Recomputes the version on save.** `GetMinKdbxVersion()` takes `Math.Max(minVersionForKeys, m_uFileVersion)` with the comment "don't save a version lower than what we read", and then the KeePass-style rule [K2A-minver]. But `PwDatabase.Save()` creates a **new** `KdbxFile` for every save [K2A-save]. In that new object `m_uFileVersion` still has its initial value of `0` [K2A-field]. The reader sets `m_uFileVersion` only on the object that loaded the file [K2A-read]. So on the normal save path the guard does nothing, and the result is the recomputed minimum. Unlike KeePass 2.61, that minimum can be **3.1** (AES cipher, AES-KDF, no CustomData or PublicCustomData) [K2A-minver]. This conclusion comes from reading the code and was not tested.
- **What it drops.** The writer gates the same elements as KeePass, so `PreviousParentGroup` and CustomData timestamps are dropped on a save below 4.1 [K2A-write].
- **Since 1.09a** (tag `1.09a-r3`, 2021-08-22): "Added support for KDBX 4.1 file format introduced in KeePass 2.48" [K2A-changelog].

### KeePassium

- **Reads 4.1.** Any `0x0004xxxx` is accepted as v4. Only exactly `0x00040001` is tagged `.v4_1` [KM-read]. So a hypothetical 4.2 file would open with no warning and be treated as plain 4.0.
- **Keeps the version and only ever upgrades.** `upgradeFormatVersion` has `precondition(newerVersion >= formatVersion, "Downgrading the database format is not supported")` [KM-upgrade]. When a 4.1 feature is used on a 4.0 file, the version is raised to 4.1 without a prompt, because 4.0 → 4.1 does not count as a major difference. Upgrades from 3 to 4 do ask the user first [KM-coord] [KM-feature].
- **Writes the 4.1 elements** whenever the format supports the feature (`.qualityCheckFlag`, `.customIconName`, `.previousParentGroup`, `.groupTags` all require `.v4_1`) [KM-feature]. It writes CustomData item `LastModificationTime` whenever the item has one [KM-cd].
- **Strict parser.** An unexpected child inside `CustomData/Item` is logged as "Unexpected XML tag" and raises an error [KM-cd]. This does not affect 4.1 support, but it means KeePassium is the least tolerant client of unexpected XML from a writer.
- **Since 1.24.87** (2021-05-06): "Support for KDBX 4.1 format [thanks, Dominik]" [KM-changelog].

### What this means for keepass-rs writing only 4.1

- keepass-rs reads and writes all five 4.1 additions: group `tags` and `previous_parent_group` [KR-group], entry `quality_check` and `previous_parent_group` [KR-entry]. The kdbx-core-libraries round trip also kept CustomData timestamps and icon names.
- **Every current client accepts what keepass-rs writes.** The upgrade breaks only clients older than 4.1 support:
  - **Strongbox before 1.47.4** (April 2020) refuses the file.
  - **KeePass before 2.48** and **KeePassXC before 2.7.0** open it without warning, drop the 4.1 elements, and save it back as 4.0. That loss affects only 4.1 data.
  - KeePassDX before 2.10.0, Keepass2Android before 1.09a and KeePassium before 1.24.87 were not checked (see open risks).
- **A 4.0 file stays 4.0 only until rimlock saves it.** After that it flips between versions:
  - Strongbox, KeePassium and KeePassXC keep it at 4.1.
  - KeePass 2.x, KeePassDX and Keepass2Android usually save it back as 4.0 (KeePassDX and Keepass2Android sometimes as 3.1) and drop `PreviousParentGroup`.
  - The next rimlock save upgrades it to 4.1 again.
  - Nothing outside 4.1-only data is lost along the way.
  - This back-and-forth already happens today between KeePassXC and KeePass whenever KeePassXC records a previous parent.

## Open risks / unknowns

- **3.1 → 4.1 conversion inside keepass-rs.** KeePassDX and Keepass2Android can turn a database into KDBX 3.1. The Extension would then reopen it as KDBX3 and save it as 4.1, which means converting the KDBX3 header (transform seed and rounds) into KDBX4 KDF parameters. Whether keepass-rs does this cleanly for a database opened as KDBX3 was not tested. It needs a round-trip test with a KeePassDX-written 3.1 fixture.
- **Older client versions still in use** (e.g. distro-packaged KeePassXC 2.6.x, unupdated mobile apps) would silently lose 4.1-only data. The only one that would refuse the file is Strongbox from before 1.47.4, released in 2020. No usage-share data was found.
- **Pre-4.1 KeePassDX, Keepass2Android and KeePassium** were not checked for how they handle a 4.1 header. Their current readers check only the major version, but their 2020-era behavior is unverified.
- **The Keepass2Android downgrade conclusion comes from reading the code**, following the `new KdbxFile(this)` save path. It was not tested. A different save path (e.g. sync or merge) that reuses the loading `KdbxFile` would keep the version.
- **A future KDBX 4.2** is handled differently by each client: Strongbox refuses it, KeePassium silently treats it as 4.0, and KeePassXC and KeePass warn. If keepass-rs ever writes a higher minor version, Strongbox users would be locked out. Today it writes 4.1 only.
- **KeePass may later always write 4.1.** It has said it will once all major ports support 4.1 [Spec41]. Every port examined here now supports it, but as of 2.61.1 KeePass has not made the switch.
- Release dates for Strongbox come from the commit messages and dates in its public repo, not from App Store release notes.

## Sources

- [Spec41]: KDBX 4.1, keepass.info. https://web.archive.org/web/20260629035532/https://keepass.info/help/kb/kdbx_4.1.html
- [KP]: KeePass 2.61.1 source, https://sourceforge.net/projects/keepass/files/KeePass%202.x/2.61.1/KeePass-2.61.1-Source.zip (SHA-256 `711bd9ec7076661678469e51bae876debac07a08c32f1b1c6b3b8fe5e761c13a`). Paths below are relative to the zip root.
  - [KP-ver]: `KeePassLib/Serialization/KdbxFile.cs` L76-L92
  - [KP-minver]: `KeePassLib/Serialization/KdbxFile.cs` L351-L397 (`GetMinKdbxVersion`)
  - [KP-read]: `KeePassLib/Serialization/KdbxFile.Read.cs` L290-L305
  - [KP-write-group]: `KeePassLib/Serialization/KdbxFile.Write.cs` L505-L513
  - [KP-write-entry]: `KeePassLib/Serialization/KdbxFile.Write.cs` L540-L546
  - [KP-write-cd]: `KeePassLib/Serialization/KdbxFile.Write.cs` L663-L677
  - [KP-write-icon]: `KeePassLib/Serialization/KdbxFile.Write.cs` L682-L705
- [KP247]: KeePass 2.47 source, https://sourceforge.net/projects/keepass/files/KeePass%202.x/2.47/KeePass-2.47-Source.zip: `KeePassLib/Serialization/KdbxFile.cs` L84 (`FileVersion32 = 0x00040000`), `KdbxFile.Read.cs` L286 (major-only check)
- KeePassXC @ `9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd`:
  - [KX-ver]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KeePass2.h#L33-L39
  - [KX-writer-ver]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KeePass2Writer.cpp#L52-L108
  - [KX-write]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KeePass2Writer.cpp#L122-L131
  - [KX-reader]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KeePass2Reader.cpp#L84-L88
  - [KX-db-mismatch]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Database.cpp#L214-L217
  - [KX-mismatch]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/gui/DatabaseOpenWidget.cpp#L351-L360
  - [KX-xml-icon]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KdbxXmlWriter.cpp#L199-L213
  - [KX-xml-cd]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KdbxXmlWriter.cpp#L264-L292 (Meta call site with `true` at L169; group and entry call sites L334, L475)
  - [KX-xml-group]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KdbxXmlWriter.cpp#L333-L338
  - [KX-xml-entry]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/format/KdbxXmlWriter.cpp#L407-L414
  - [KX-entry-move]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/src/core/Entry.cpp#L1405-L1428
  - [KX-changelog]: https://github.com/keepassxreboot/keepassxc/blob/9e0f57a4a4c6c629fa6d0a593acb7d089b1d95cd/CHANGELOG.md (L3 2.8.0-beta1, L71 2.7.12, L479-L482 2.7.0 "Implement KDBX 4.1 [#7114]")
  - [KX266]: https://github.com/keepassxreboot/keepassxc/blob/2.6.6/src/format/KeePass2Reader.cpp#L83-L90
- Strongbox @ `c70fc7b021d9dfa2b18a6d7e13406e717dd5251a`:
  - [SB-gate]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/Kdbx4Database.m#L23-L37
  - [SB-gate-cmp]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/KdbxSerializationCommon.m#L76-L83
  - [SB-load]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/Kdbx4Database.m#L99
  - [SB-save]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/Kdbx4Database.m#L167
  - [SB-default]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/UnifiedDatabaseMetadata.m#L23
  - [SB-settings]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/EncryptionSettingsViewModel.m#L531-L537
  - [SB-entry]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/Entry.m#L227-L245
  - [SB-group]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/KeePassGroup.m#L172-L214
  - [SB-cd]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/CustomData.m#L52-L74
  - [SB-icon]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/CustomIcon.m#L60-L78
  - [SB-unmanaged]: https://github.com/strongbox-password-safe/Strongbox/blob/c70fc7b021d9dfa2b18a6d7e13406e717dd5251a/model/keepass/BaseXmlDomainObjectHandler.m#L109-L125
  - [SB-2020-02]: https://github.com/strongbox-password-safe/Strongbox/blob/9a2475ddf/model/keepass/Kdbx4Database.m#L22 (2020-02-24)
  - [SB-2020-11]: https://github.com/strongbox-password-safe/Strongbox/blob/8db4bd3c5/model/keepass/Kdbx4Database.m#L23 (comment dated 10-Apr-2020; present by 1.48.18, 2020-07-03, commit `3279cb963`)
  - [SB-consts-2021]: https://github.com/strongbox-password-safe/Strongbox/blob/1d466d353/model/keepass/KeePassConstants.h#L94-L95 (absent at `b76c518c0`, 2021-02-15)
- KeePassDX @ `2db52c5fd016aad50352ba60383f6aefd29100c4` (paths under `database/src/main/java/com/kunzisoft/keepass/database/`):
  - [DX-minver]: https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/element/database/DatabaseKDBX.kt#L284-L321
  - [DX-check]: https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/element/Database.kt#L262-L266
  - [DX-save-run]: https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/app/src/main/java/com/kunzisoft/keepass/database/action/SaveDatabaseRunnable.kt#L59-L60
  - [DX-header]: https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/file/DatabaseHeaderKDBX.kt#L79-L80
  - [DX-valid]: https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/file/DatabaseHeaderKDBX.kt#L231-L234
  - [DX-out-header]: https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/file/output/DatabaseOutputKDBX.kt#L337
  - [DX-cd]: https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/file/output/DatabaseOutputKDBX.kt#L660-L676
  - [DX-ppg]: https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/database/src/main/java/com/kunzisoft/keepass/database/file/output/DatabaseOutputKDBX.kt#L685-L691
  - [DX-changelog]: https://github.com/Kunzisoft/KeePassDX/blob/2db52c5fd016aad50352ba60383f6aefd29100c4/CHANGELOG#L449-L450; release 2.10.0 published 2021-05-07
- Keepass2Android @ `76d8502a2e42a10267bfb626c6292ec02fcf48c0`:
  - [K2A-minver]: https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/KeePassLib2Android/Serialization/KdbxFile.cs#L382-L454
  - [K2A-field]: https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/KeePassLib2Android/Serialization/KdbxFile.cs#L263
  - [K2A-save]: https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/KeePassLib2Android/PwDatabase.cs#L664-L667
  - [K2A-read]: https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/KeePassLib2Android/Serialization/KdbxFile.Read.cs#L318-L323
  - [K2A-write]: https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/KeePassLib2Android/Serialization/KdbxFile.Write.cs (L113 version selection; 4.1 gates at L544, L579, L584, L713, L737)
  - [K2A-changelog]: https://github.com/PhilippC/keepass2android/blob/76d8502a2e42a10267bfb626c6292ec02fcf48c0/src/keepass2android-app/Resources/values/strings.xml#L863-L864; release `1.09a-r3` published 2021-08-22
- KeePassium @ `e651df4f89b0b8550371566ca9aa55a964d2904e`:
  - [KM-read]: https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Header2.swift#L290-L315
  - [KM-upgrade]: https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Header2.swift#L622-L626
  - [KM-feature]: https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/DatabaseFeature2.swift#L17-L30; `hasMajorDifferences` in https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/Database2.swift#L31-L39
  - [KM-coord]: https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassium/util/coordinator/Coordinator+databaseUpgrade.swift#L23-L50
  - [KM-cd]: https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/KeePassiumLib/KeePassiumLib/db/kp2/CustomData2.swift#L91-L146
  - [KM-changelog]: https://github.com/keepassium/KeePassium/blob/e651df4f89b0b8550371566ca9aa55a964d2904e/CHANGELOG.md#L1470-L1474
- keepass-rs @ `d08c680`:
  - [KR-group]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/format/xml_db/group.rs#L33-L172
  - [KR-entry]: https://github.com/sseemayer/keepass-rs/blob/d08c68084cd40db9bacf38dbb151d478623fda2b/src/format/xml_db/entry.rs#L54-L232
