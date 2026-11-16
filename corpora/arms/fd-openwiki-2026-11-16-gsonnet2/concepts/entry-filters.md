---
type: concept
title: "Entry Filters: Type, Extension, Size, Time, Owner"
description: Semantics, parsing and evaluation order of fd's post-name-match filters - file type, extension, size, modification time and (Unix) owner - including lazy metadata loading and platform gating.
tags: [filters, size, time, owner, file-type, extension]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
sources:
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-8b3eaed746bb796650559c48
    resource: repo://src/filetypes.rs
  - id: openwiki-source-c7455adc83d664149895de1b
    resource: repo://src/filter/owner.rs
  - id: openwiki-source-a0933a10afe9624b44e21d5f
    resource: repo://src/filter/size.rs
  - id: openwiki-source-0d5ea0012fa8783c7eda55f2
    resource: repo://src/filter/time.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# Entry Filters

After an entry's name matches the patterns (see [[architecture/pattern-matching]]), the sender closure in `src/walk.rs::spawn_senders` applies the filters below in a fixed order: **extension → file type → owner → size → time**. Each returns `WalkState::Continue` (skip entry) on mismatch. See [[architecture/parallel-walk-pipeline]] for the surrounding loop. All filters are parsed once in `main.rs::construct_config` and stored in `Config`, so invalid values fail before the walk starts (see [[architecture/cli-and-config]]).

## Extension (`-e/--extension`)

Each value has leading dots trimmed and becomes the regex `.\.<escaped ext>$`; the set is compiled as a case-insensitive `RegexSet` and matched against the file name only. Entries without a file name are rejected.

## File type (`-t/--type`)

`--type` values (`file`, `directory`, `symlink`, `block-device`, `char-device`, `executable`, `empty`, `socket`, `pipe`, with single-letter aliases) fold into the `FileTypes` struct of booleans:

- `executable` sets `executables_only` **and** `files`; `empty` sets `empty_only`.
- If only `empty` was given, both `files` and `directories` are enabled, so empty files and empty directories both match.
- `FileTypes::should_ignore` (`src/filetypes.rs`) rejects an entry whose type is unselected, which is non-executable (via the `faccess` crate) under `executables_only`, or non-empty under `empty_only`. Entries of unrecognized type, or whose type cannot be determined, are also rejected.
- Block/char device, socket and pipe predicates are `cfg`-gated in `filesystem.rs` and always false on platforms without them.

Because type filters use `file_type()` from the walker, they normally need no extra syscall; `empty` and `executable` do.

## Size (`-S/--size`)

`SizeFilter::from_string` parses `[+-]?<digits><unit>` with a case-insensitive regex. The sign selects the comparison: `+` is minimum (`>=`), `-` is maximum (`<=`), no sign is exact equality. Units: `b`, SI `k/m/g/t` (powers of 1000), and binary `ki/mi/gi/ti` (powers of 1024), with optional trailing `b`. Multiple `--size` values must **all** hold. In the walker, size constraints apply only to regular files: directories and other types are filtered out whenever any size constraint is present, as are files whose metadata cannot be read.

## Modification time (`--changed-within/--newer`, `--changed-before/--older`)

`TimeFilter::from_str` accepts, in order: a duration (jiff `Span`, subtracted from "now"), an RFC 3339 `Timestamp`, a civil `DateTime` interpreted in the system time zone (later of an ambiguous pair), or `@<unix seconds>`. `after` yields `TimeFilter::After` (strictly newer) and `before` yields `Before` (strictly older). Both constraints may be given and must all match. An entry without readable modification time never matches. Unit tests control "now" through a thread-local override (`TESTTIME`) compiled only under `cfg(test)`.

## Owner (`-o/--owner`, Unix only)

`OwnerFilter::from_string` parses `user:group` where either side may be empty, numeric or a name (resolved with `nix::unistd::User/Group`), and may be negated with a leading `!` (`Check::Equal`, `NotEq`, `Ignore`). More than one `:` is an error and unknown names produce "not a recognized user/group name". `filter_ignore` converts a no-op filter (`""` or `":"`) to `None`, so no metadata is fetched. Matching uses `MetadataExt::uid/gid`. The module, the `Config.owner_constraint` field and the walker branch are all `#[cfg(unix)]`.

## Metadata laziness

`DirEntry::metadata` caches `Option<Metadata>` in a `OnceCell`; filters that need it call it only after earlier checks pass, so cheap rejections avoid `stat` calls entirely.

## Tests

Parsing logic has in-module unit tests (`size.rs`, `time.rs`, `owner.rs`); end-to-end coverage is in `test_type*`, `test_extension`, `test_size`, `test_modified_relative`, `test_modified_absolute` and `test_owner_*` (see [[operations/testing]]).
