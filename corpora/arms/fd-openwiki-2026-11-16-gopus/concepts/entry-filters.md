---
type: concept
title: "Entry Filters: Type, Extension, Size, Time, Owner, Depth"
description: The per-entry filter chain fd applies in its walker threads after name matching — depth limits, extension, file type (including executable and empty), owner, size, and modification time — with parsing rules, evaluation order, and metadata costs.
tags: [filters, file-types, size, time, owner, depth, traversal]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
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
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Entry Filters: Type, Extension, Size, Time, Owner, Depth

Besides the name pattern ([Pattern Matching](pattern-matching.md)), fd narrows
results with a set of filters. All of them are parsed once into `Config`
(`src/main.rs` `construct_config`, types in `src/filter/` and `src/filetypes.rs`)
and evaluated per entry inside the sender closure in `src/walk.rs`
(see [Parallel Walk](../architecture/parallel-walk-and-receiver.md)).

## Evaluation order

For each walker entry that survives ignore rules, the sender evaluates, in order:

1. `--max-depth` — enforced by the walker itself (`WalkBuilder::max_depth`), so
   deeper directories are never read.
2. `--min-depth` — entries shallower than the minimum (or with unknown depth,
   i.e. broken symlinks) are skipped but their subtrees are still traversed.
3. Name/path regexes (all patterns must match).
4. `--extension`.
5. `--type`.
6. `--owner` (Unix only).
7. `--size`.
8. `--changed-within` / `--changed-before`.

Any failing filter returns `WalkState::Continue`, which drops the entry but keeps
descending. Cheap, metadata-free checks run first; owner, size, and time need
`DirEntry::metadata()`, which is computed lazily and cached in a `OnceCell` so it
is fetched at most once per entry. If metadata cannot be read, the entry is
excluded whenever a metadata-based filter is active.

`--exact-depth N` is shorthand for `--min-depth N --max-depth N` and conflicts
with both. `--prune` (conflicts with `--size` and `--exact-depth`) is not a filter:
after a match is *sent*, the sender returns `WalkState::Skip` so the matched
directory is not descended into.

## Extensions (`-e/--extension`)

Each extension (leading dots trimmed, regex-escaped) becomes the pattern
`.\.ext$` in one case-insensitive `RegexSet`, matched against the file name only.
The leading `.` in the pattern requires at least one character before the dot,
so a file named exactly `.rs` does not match `-e rs`. Extensions match every entry
type, including directories; combine with `--type` to restrict.

## File types (`-t/--type`)

`--type` values (`file|f`, `directory|d|dir`, `symlink|l`, `executable|x`,
`empty|e`, `socket|s`, `pipe|p`, `char-device|c`, `block-device|b`) are folded
into a `FileTypes` struct of booleans:

- `executable` sets `executables_only` and also enables `files`.
- `empty` sets `empty_only`; if neither files nor directories were requested, it
  enables both.

`FileTypes::should_ignore` rejects an entry if its type was not requested, if
`executables_only` is set and the path is not executable (checked with
`faccess`), if `empty_only` is set and the entry is not empty, or if the entry is
of an unknown type. Emptiness (`filesystem::is_empty`) means a directory with no
entries or a regular file of length 0. Entries with no determinable file type are
always rejected. On Windows the device/socket/pipe predicates are always false.

Symlinks are reported as symlinks unless `-L/--follow` is used, in which case the
walker reports the target's type.

## Size (`-S/--size`)

`SizeFilter::from_string` parses `<+|-><NUM><UNIT>` with the case-insensitive
regex `^([+-]?)(\d+)(b|[kmgt]i?b?)$`:

- `+` → `Min` (size ≥ limit), `-` → `Max` (size ≤ limit), no sign → `Equals`.
- `k/m/g/t` are SI (powers of 1000); `ki/mi/gi/ti` are binary (powers of 1024);
  `b` is bytes. A trailing `b` is optional (`10kb` = `10k`).

Size filters apply only to regular files (`entry_path.is_file()`); directories
and other types are excluded whenever any size filter is present. Multiple
`--size` values must all be satisfied, which allows ranges such as
`-S +1k -S -1M`.

## Modification time (`--changed-within`, `--changed-before`)

`TimeFilter::from_str` (`src/filter/time.rs`) tries, in order:

1. a `jiff::Span` duration (e.g. `10h`, `2weeks`, `1d`), interpreted as
   *now minus span*;
2. a `jiff::Timestamp` (RFC 3339 with offset);
3. a civil `DateTime`/date (e.g. `2018-10-27` or `2018-10-27 10:00:00`) in the
   system time zone, resolving ambiguity with `.later()`;
4. `@<unix seconds>`.

`--changed-within` builds `After(t)` (mtime strictly greater) and
`--changed-before` builds `Before(t)` (mtime strictly less); both may be combined
and all must match. Aliases: `--change-newer-than`, `--newer`, `--changed-after`,
and `--change-older-than`, `--older`. Unparsable values abort the run with
"is not a valid date or duration". Tests inject a fixed "now" through a
thread-local `TESTTIME`.

## Owner (`-o/--owner`, Unix only)

`OwnerFilter::from_string` accepts `[user|uid][:group|gid]`. Each side may be
omitted (meaning "ignore"), may be a numeric id or a name resolved through
`nix::unistd::User/Group::from_name`, and may be prefixed with `!` to negate.
More than one `:` is an error; `""` and `":"` parse to a no-op filter, which
`filter_ignore` turns into `None` so no metadata is fetched. Matching compares the
entry's `uid()`/`gid()` from metadata.

## Ignore-contain and broken symlinks

`--ignore-contain <name>` is evaluated before all filters: a directory containing
the named file is skipped entirely (see
[Ignore Rules](ignore-rules-and-hidden-files.md)). Broken symlinks surface as
`DirEntry::broken_symlink` entries whose metadata comes from
`symlink_metadata()`, so they match `--type symlink`.

## Tests

- `src/filter/size.rs`: macro-generated parsing tests for every unit and sign,
  plus `is_within` tests.
- `src/filter/time.rs`: durations, dates, timestamps, and `@` epoch parsing
  against a pinned reference time.
- `src/filter/owner.rs`: `owner_parsing` table covering negation and colon edge
  cases.
- `tests/tests.rs`: `test_type*`, `test_extension*`, `test_size*`,
  `test_modified_*`, `test_owner*`, `test_min_depth`, `test_exact_depth`,
  `test_prune` run end-to-end.
