---
type: concept
title: Entry Filters (Type, Extension, Size, Time, Owner)
description: The filters fd applies after a name match, based on extension or metadata. Covers --type semantics including executable and empty, --extension matching, --size units, --changed-within/--changed-before time parsing, --owner user:group checks, and the order they run in and what they cost.
tags: [filters, file-type, size, time, owner, extension, metadata]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
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
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# Entry Filters

A walked entry must first match every name pattern (see [Pattern Matching](pattern-matching.md)). After that, worker threads run a fixed chain of filters in `src/walk.rs`. The chain is ordered roughly by cost, so the entries that are dropped early never trigger extra syscalls:

1. extension (name only)
2. file type (`--type`)
3. owner (`--owner`, Unix only)
4. size (`--size`)
5. modification time (`--changed-within` / `--changed-before`)

When an entry is rejected, the closure returns `WalkState::Continue`, which means "don't report, but keep descending". Filters never prune the walk. Only `--prune`, `--exclude`, and ignore rules do that (see [Ignore Rules and Traversal Controls](ignore-rules-and-traversal.md)).

Metadata comes from `DirEntry::metadata()`, which is computed once per entry and cached in a `OnceCell`. Normal entries use `ignore::DirEntry::metadata()`, and broken symlinks use `symlink_metadata()`. When several metadata filters are active, they all share one `stat`.

## Extension (`-e/--extension`)

`construct_config` strips any leading `.` from each extension and builds one case-insensitive `RegexSet` with patterns of the form `.\.<ext>$`. The extension is escaped, and the leading `.` requires at least one character before the dot. The set is matched against the entry's **file name** bytes. Effects:

- Matching is case-insensitive no matter what the smart-case setting is, so `-e jpg` matches `IMG.JPG`.
- Multi-part extensions work, for example `-e tar.gz`.
- A dotfile such as `.gitignore` does not count as having extension `gitignore`.
- Directories whose names end in the extension also match unless `--type` restricts the results.

## File type (`-t/--type`)

`--type` values are collected into a `FileTypes` struct (`src/filetypes.rs`). `FileTypes::should_ignore` rejects an entry when:

- its kind (file, dir, symlink, block device, char device, socket, pipe) was not requested, or
- `executables_only` is set and `faccess`'s `PathExt::executable()` says the current effective user can't execute it, or
- `empty_only` is set and `filesystem::is_empty` is false, or
- its kind is none of the known kinds, or its file type can't be determined.

Two values work differently from the rest:

- **`executable` (`x`)** sets `executables_only` **and** `files`, so `-tx` means "executable regular files". Add `-td` to include directories that have the execute bit.
- **`empty` (`e`)** only sets `empty_only`. If neither `file` nor `directory` was also given, `construct_config` turns on both, so `-te` finds empty files and empty directories. "Empty" means a zero-length regular file, or a directory whose `read_dir` returns no entries. An unreadable directory counts as non-empty.

Symlinks are reported as symlinks unless `--follow` is set. Block devices, char devices, sockets, and pipes are always `false` on Windows (`src/filesystem.rs`).

## Size (`-S/--size`)

`SizeFilter::from_string` (`src/filter/size.rs`) accepts input matching `^([+-]?)(\d+)(b|[kmgt]i?b?)$`, case-insensitively:

| Prefix | Meaning |
| --- | --- |
| `+` | size ≥ limit (`Min`) |
| `-` | size ≤ limit (`Max`) |
| none | size == limit (`Equals`) |

Units: `b` means bytes. `k`/`m`/`g`/`t` (optionally followed by `b`) are SI powers of 1000. `ki`/`mi`/`gi`/`ti` (optionally followed by `b`) are binary powers of 1024. **The unit is mandatory**, so `+18` and `9999` are rejected. clap rejects invalid values at parse time.

Semantics:

- If you pass `--size` more than once, **all** constraints must hold. For example, `-S +1k -S -1m` is a range.
- Only regular files can pass. The check is `entry_path.is_file()`, which follows symlinks, so directories and other entry types are always excluded while any size filter is active.
- If metadata can't be read, the entry is excluded.

## Modification time (`--changed-within` / `--changed-before`)

Both options are parsed by `TimeFilter::from_str` (`src/filter/time.rs`) using `jiff`. The parser tries these forms in order:

1. A **duration** (`jiff::Span`, for example `10h`, `2weeks`, `1d 3h`). It is subtracted from the current local time.
2. An RFC 3339 / ISO **timestamp** with an offset (`2018-10-27T10:00:00+02:00`).
3. A civil **date or datetime** without an offset (`2018-10-27`, `2018-10-27 10:00:00`), interpreted in the system time zone. Ambiguous local times resolve to the later instant.
4. A Unix **epoch** in seconds, which must be prefixed with `@` (`@1707723412`). A bare number is rejected.

`--changed-within` builds `TimeFilter::After(t)`, which needs `mtime > t`. `--changed-before` builds `TimeFilter::Before(t)`, which needs `mtime < t`. Both comparisons are strict. If both options are given, both must hold. An unparsable value fails at Config construction with `'<value>' is not a valid date or duration`. Entries without readable metadata or mtime are excluded. Aliases: `--change-newer-than`, `--newer`, `--changed-after` / `--change-older-than`, `--older`.

Unit tests override "now" through a thread-local `TESTTIME` so duration parsing can be tested deterministically.

## Owner (`-o/--owner`, Unix only)

`OwnerFilter::from_string` (`src/filter/owner.rs`) parses `[user|uid][:group|gid]`:

- Either side may be left out (`john`, `:students`, `5:`).
- A leading `!` negates that side (`!john:students`).
- Numeric values are used as uid/gid directly. Names are resolved through `nix::unistd::User::from_name` / `Group::from_name`, and an unknown name is a parse error.
- More than one `:` is an error.
- `""` or `":"` parse to a no-op filter, which `filter_ignore()` drops, so no owner check runs.

The check compares `MetadataExt::uid()/gid()` against each side. If metadata is missing, the entry is excluded.

## Related

- Option wiring and defaults: [CLI Options and Config Mapping](../reference/cli-and-configuration.md)
- Where filters run in the thread pipeline: [Parallel Search Pipeline](../architecture/search-pipeline.md)
- Tests: unit tests in each `src/filter/*.rs` module, plus integration tests such as `test_type`, `test_type_executable`, `test_type_empty`, `test_extension`, `test_size`, `test_modified_relative`, `test_modified_absolute`, and `test_owner_*` in `tests/tests.rs`.
