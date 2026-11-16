---
type: concept
title: "Entry Filters: Type, Size, Time, Owner"
description: How fd's per-entry filters work — --type (including executable and empty), --size, --changed-within/--changed-before, --owner, depth limits and --prune — including parsing rules, semantics, evaluation order in the walker, and metadata cost.
tags: [filters, file-type, size, time, owner, depth]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
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
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# Entry Filters: Type, Size, Time, Owner

After an entry passes the name/path [pattern match](pattern-matching.md), the sender callback in `src/walk.rs` applies a fixed sequence of filters. Every filter is an *AND* constraint: failing any one drops the entry (`WalkState::Continue`, i.e. the entry is not reported but traversal still descends into it). See [Parallel Walk and Receiver](../architecture/parallel-walk-and-receiver.md) for the full callback.

## Evaluation order

| Order | Filter | Option(s) | Needs metadata? |
|-------|--------|-----------|-----------------|
| 0 | Max depth (walker-level) | `--max-depth`/`-d`, `--exact-depth` | No |
| 1 | Min depth | `--min-depth`, `--exact-depth` | No |
| 2 | Pattern(s) | positional pattern, `--and` | No |
| 3 | Extension | `--extension`/`-e` | No |
| 4 | File type | `--type`/`-t` | File type from the directory read; `stat` for `empty` / `executable` checks |
| 5 | Owner (Unix only) | `--owner`/`-o` | Yes |
| 6 | Size | `--size`/`-S` | Yes |
| 7 | Modification time | `--changed-within`, `--changed-before` | Yes |
| after send | Prune | `--prune` | No |

Metadata is fetched lazily once per entry and cached in `DirEntry`'s `OnceCell`, so owner, size and time filters (and coloring) share a single `stat`. If metadata cannot be read, an entry with an owner, size or time constraint is excluded.

## Depth

- `--max-depth` is passed directly to `ignore::WalkBuilder::max_depth`, so the walker never descends deeper.
- `--min-depth` is checked in the callback: shallower entries are skipped but still traversed. Broken symlinks have no depth and are therefore dropped whenever a min depth is set.
- `--exact-depth N` is sugar for `--min-depth N --max-depth N` (via `Opts::min_depth()` / `max_depth()`), and conflicts with explicit min/max depth.

## File types (`src/filetypes.rs`)

`--type` may be repeated; `construct_config` folds the values into a `FileTypes` struct of booleans. `FileTypes::should_ignore` excludes an entry if:

- its kind (file, directory, symlink, block device, char device, socket, pipe) was not requested;
- `executables_only` is set and the path is not executable (checked with `faccess`'s `PathExt::executable`, i.e. an access check for the current user rather than just mode bits);
- `empty_only` is set and the entry is not empty — an empty directory has no entries (`read_dir`), an empty file has length 0; any other kind is never empty;
- its kind is none of the known kinds, or the file type is unknown.

Special combinations resolved in `construct_config`:

- `--type executable` also sets `files = true` (executables are files).
- `--type empty` alone sets both `files` and `directories`; combined with `-tf` or `-td` it narrows to empty files or empty directories.

On Windows, the block/char device, socket and pipe predicates in `src/filesystem.rs` always return `false`.

## Size (`src/filter/size.rs`)

`SizeFilter::from_string` parses `<+|-><NUM><UNIT>` with the case-insensitive regex `^([+-]?)(\d+)(b|[kmgt]i?b?)$`:

- `+` → `Min` (size ≥ limit), `-` → `Max` (size ≤ limit), no sign → `Equals`.
- Units: `b` bytes; `k`,`m`,`g`,`t` are SI (powers of 1000); `ki`,`mi`,`gi`,`ti` are binary (powers of 1024). A trailing `b` is optional (`kb`, `KiB`).

Multiple `--size` values are combined with AND (e.g. `-S +1k -S -1M`). In the walker, size constraints apply **only to regular files**: when any size constraint is present, directories, symlinks to non-files and other kinds are excluded. `--prune` conflicts with `--size`.

## Modification time (`src/filter/time.rs`)

`--changed-within` (aliases `--changed-after`, `--newer`, `--change-newer-than`) creates `TimeFilter::After`, and `--changed-before` (aliases `--older`, `--change-older-than`) creates `TimeFilter::Before`. The argument is parsed in `construct_config` (an invalid value aborts with "is not a valid date or duration") by trying, in order:

1. a `jiff::Span` duration (e.g. `10h`, `2weeks`, `35min`), subtracted from the current zoned time;
2. a `jiff::Timestamp` (RFC 3339 instant with offset);
3. a civil `DateTime`/date in the system time zone (ambiguous times resolve to the later instant);
4. `@<unix-seconds>`.

`applies_to` uses strict comparisons (`mtime > limit` for After, `mtime < limit` for Before). When both options are given, both must hold. Entries whose modification time cannot be read are excluded.

Tests override "now" through a thread-local `TESTTIME`, so unit tests are deterministic.

## Owner (`src/filter/owner.rs`, Unix only)

`--owner [user|uid][:group|gid]` is parsed by `OwnerFilter::from_string`:

- Either side may be omitted; an empty side means "don't check".
- Each side may be numeric or a name resolved via `nix::unistd::User::from_name` / `Group::from_name` (unknown names are errors).
- A leading `!` negates that side (`'!john:students'` = not owned by john, but in group students).
- More than one `:` is an error.

If both sides are empty (e.g. `--owner :`), `filter_ignore` turns the filter into `None` so it costs nothing. Matching compares `MetadataExt::uid()` / `gid()` of the entry.

## Prune

`--prune` is applied *after* a matching entry has been sent: the callback returns `WalkState::Skip`, so the walker does not descend into a matching directory. Non-matching directories are still traversed. It conflicts with `--size` and `--exact-depth`.

## Related options handled elsewhere

- Hidden/ignored entries and `--exclude` globs are filtered by the `ignore` crate before the callback runs — see [Ignore Rules and Hidden Files](ignore-rules-and-hidden-files.md).
- `--ignore-contain` skips directories containing a marker file — see [Parallel Walk and Receiver](../architecture/parallel-walk-and-receiver.md).

## Tests

Unit tests live next to each filter (`size.rs` has a macro-generated parse table; `time.rs` and `owner.rs` test parsing and matching). Integration tests in `tests/tests.rs` cover `--type`, `--size`, `--changed-*`, `--owner`, depth options and `--prune` against temporary directory trees — see [Testing](../testing/integration-tests.md).
