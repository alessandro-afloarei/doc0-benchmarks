---
type: concept
title: "Entry Filters: Type, Extension, Size, Time, Owner"
description: Semantics, parsing rules and metadata cost of fd's per-entry filters - file type, extension, size, changed-within/before and Unix owner - as applied in the walker's sender closure.
tags: [filters, size, time, owner, file-type, extension]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
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
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# Entry Filters: Type, Extension, Size, Time, Owner

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-walk-and-receiver.md] link "/openwiki/architecture/parallel-walk-and-receiver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
These filters are evaluated per entry inside the walker threads (see [parallel walk](/openwiki/architecture/parallel-walk-and-receiver.md)), *after* the name/path regex has already matched and in this order: extension → file type → owner → size → time. Each is built once during [config construction](/openwiki/architecture/cli-and-configuration.md) and stored on `Config`; an absent filter costs nothing at runtime.

## File type (`src/filetypes.rs`)

`FileTypes` is a set of booleans populated from repeated `--type` values: `files`, `directories`, `symlinks`, `block_devices`, `char_devices`, `sockets`, `pipes`, plus modifiers `executables_only` and `empty_only`. `FileTypes::should_ignore(entry)` returns true (skip) when:

- the entry's kind is not enabled (note: a symlink is only a symlink here, since the walker doesn't follow by default), **or**
- `executables_only` and the path is not executable (`faccess`), **or**
- `empty_only` and the entry is not empty (`filesystem::is_empty`: directory with no entries, or regular file with length 0), **or**
- the entry is of an unrecognized kind, **or** its file type is unknown (`None` → ignore).

Config lowering adds implications: `executable` also enables `files`; `empty` used alone enables both files and directories. Device/socket/pipe predicates are real only on Unix/Redox; on Windows they return `false`.

## Extension

`-e` values become a case-insensitive `RegexSet` built from `.\.<escaped ext>$`, with leading dots in the user input trimmed. It is matched against the *file name* bytes only, so the extension filter is independent of `--full-path`; an entry with no file name never matches. The leading `.` in the pattern means a file named just `.rs` does not satisfy `-e rs`.

## Size (`src/filter/size.rs`)

`SizeFilter` (`Max`, `Min`, `Equals`) is parsed from `--size` by a clap value parser via a case-insensitive regex `^([+-]?)(\d+)(b|[kmgt]i?b?)$`. A `+` prefix means *at least*, `-` means *at most*, and no sign means *exactly* (the sign group always participates in the regex and matches the empty string, so the `"+"` fallback in `map_or` is never reached and `limit_kind == ""` yields `Equals`). Units: `b`; decimal `k/m/g/t` (powers of 1000) and binary `ki/mi/gi/ti` (powers of 1024), with optional trailing `b`. Multiple `--size` flags must *all* hold (`any(|sc| !sc.is_within(size))` rejects).

Runtime behavior in the walker: when any size constraint exists, only entries for which `entry_path.is_file()` pass - directories and non-files are dropped - and entries whose metadata can't be read are dropped.

## Time (`src/filter/time.rs`)

`--changed-within` builds `TimeFilter::After(t)` and `--changed-before` builds `TimeFilter::Before(t)`. The argument is interpreted by `TimeFilter::from_str` trying, in order: (1) a `jiff::Span` duration like `10h` or `2weeks`, subtracted from *now*; (2) an RFC 3339 `Timestamp`; (3) a civil `DateTime` interpreted in the system time zone (the later instant for ambiguous local times); (4) `@<unix seconds>`. Anything else yields the error `'…' is not a valid date or duration`. Comparisons are strict (`t > limit` / `t < limit`) against the entry's modification time. In tests `now()` is replaced with a thread-local fake clock so relative durations are deterministic.

Runtime: if time constraints exist, an entry matches only if metadata and its modification time are available and *all* constraints apply; otherwise it is skipped.

## Owner (`src/filter/owner.rs`, Unix only)

`--owner user:group` parses into `OwnerFilter { uid, gid }`, each side a `Check` of `Equal`, `NotEq` (prefix `!`) or `Ignore` (empty). Names are resolved via `nix` (`User::from_name`/`Group::from_name`), numeric IDs are accepted directly, unknown names produce an error, and more than one `:` is an error. A fully ignoring spec (`""` or `":"`) is dropped by `filter_ignore()` so no per-entry cost is incurred. `matches` compares against `MetadataExt::uid()/gid()`.

## Metadata cost model

`DirEntry::metadata()` caches the result in a `OnceCell`, so combining owner, size and time costs at most one stat per entry; ordering means entries rejected by the name regex never trigger a stat. `FileTypes::should_ignore` uses the walker-provided `file_type()` (no extra syscall) except for `empty` and `executable`, which hit the filesystem.

## Testing

<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Integration tests: `test_type`, `test_type_executable`, `test_type_empty`, `test_extension`, `test_no_extension`, `test_size`, `test_modified_relative`, `test_modified_absolute`, `test_owner_*` in `tests/tests.rs`; unit tests for size parsing, time parsing and owner parsing sit alongside each filter module. See the [test harness](/openwiki/testing/integration-test-harness.md).
