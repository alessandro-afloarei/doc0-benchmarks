---
type: architecture
title: Search Filters and Ignore Rules
description: Every filter fd applies to a candidate entry, split into walker-level rules (hidden files, ignore files, excludes, depth, pruning) and sender-level predicates (name, extension, file type, owner, size, modification time), with their order, semantics and cost.
tags: [filters, ignore, gitignore, fdignore, hidden, size, time, owner, extension, file-type]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:10:54.611Z
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
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T18:10:54.611Z" }
---

# Search Filters and Ignore Rules

An entry printed by `fd` has passed a sequence of filters. Some are enforced
by the `ignore` crate while the directory tree is being read, and the rest are
enforced by `fd` itself in the sender closure of `src/walk.rs`. Knowing which
layer a rule lives in matters: walker-level rules can prune whole subtrees,
while sender-level predicates only drop individual entries.

## Layer 1: walker-level rules (`ignore` crate)

These are configured in `WorkerState::build_walker` and `build_overrides`
(`src/walk.rs`) from the `Config` fields built in `src/main.rs`.

| Rule | Option(s) | Effect |
| --- | --- | --- |
| Hidden entries | default; `-H/--hidden`; `-u/--unrestricted` | `ignore_hidden` is true by default, so names beginning with `.` are skipped and their subtrees are not read. |
| `.fdignore` | `-I/--no-ignore` disables | Custom ignore file added as `.fdignore` in each directory. |
| Parent ignore files | `--no-ignore-parent` | Also read `.fdignore`/VCS ignore files in ancestor directories. Only applies when at least one of the ignore sources is enabled. |
| VCS ignore files | `--no-ignore-vcs` | `.gitignore`, the global git excludes file and `.git/info/exclude`. |
| Git requirement | `--no-require-git` | Without this, VCS ignore rules apply only inside a git repository. |
| Global fd ignore | `--no-global-ignore-file` | Reads `<config dir>/fd/ignore` when it exists. Config dir comes from `etcetera`. |
| Custom ignore files | `--ignore-file PATH` | Each file is added as an ignore source. Partial parse errors are ignored; other malformed patterns are reported. |
| Excludes | `-E/--exclude GLOB` | Each glob becomes an override with a `!` prefix, so matching entries (and directories) are excluded. |
| Depth | `--max-depth`, `--min-depth`, `--exact-depth` | `max_depth` is passed to the walker. `min_depth` is enforced in the sender (see below). |
| Filesystem boundary | `--one-file-system` (aliases `--mount`, `--xdev`) | Do not cross mount points. |
| Symlinks | `-L/--follow` | Follow symlinked directories. |

`-I/--no-ignore` turns off the `.fdignore`, VCS and global ignore sources
together. The `-u/--unrestricted` option (a counted flag, `rg_alias_ignore`)
is equivalent to `--no-ignore --hidden`: it turns off the same ignore sources
and also makes hidden entries visible. Hidden-file visibility and ignore-source
settings are computed separately in `construct_config`, so `--hidden` alone
changes only the first.

Because these rules are applied by the walker, a directory excluded this way
is never read, so there is no cost for its contents.

## Layer 2: sender predicates (`walk.rs`)

Each entry that survives the walker is tested in the sender closure in this
order. The order is chosen so that name and depth checks, which need no
metadata, come before anything that calls `stat`.

1. **`--ignore-contain NAME`.** For a directory, if any `NAME` exists directly
   inside it, the directory is skipped. This is checked on the directory's file
   type first, so the `exists()` call is only made for directories.
2. **Root skip.** The depth-0 root entry is never printed.
3. **`--min-depth`.** Entries shallower than the minimum are skipped, but
   traversal continues into them.
4. **Name patterns.** Every compiled pattern (the positional pattern and all
   `--and` expressions) must match. The search string is the file name, or the
   absolute path when `--full-path` is used. Matching is byte-oriented regex
   via `regex::bytes`, and case handling is described in
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md).
5. **`--extension EXT`.** A case-insensitive `RegexSet` of `\.EXT$` is tested
   against the file name. Leading dots in the argument are stripped.
6. **`--type TYPE`.** `FileTypes::should_ignore` (in `src/filetypes.rs`) drops
   entries whose type is not requested. Notes:
   - `executable` also implies `file` and checks execute permission with
     `faccess`.
   - `empty` alone implies both `file` and `directory`; `empty` then requires an
     empty regular file or an empty directory (`filesystem::is_empty`).
   - Entries whose file type cannot be determined are dropped.
7. **`--owner [user][:group]`** (Unix only). Parsed by `OwnerFilter::from_string`
   at argument-parse time; accepts names or numeric IDs and a leading `!` to
   negate. Entries without readable metadata are dropped. Owner filters that
   are both empty or `:` are treated as no filter.
8. **`--size`.** The filter is applied only to regular files. Directories and
   other non-files are dropped whenever any size constraint is present. A `+`
   prefix means at least that size, `-` means at most, and no prefix means
   exactly that size. Units are base-10 (`k`, `m`, ...) or base-2 (`ki`, `mi`,
   ...), case-insensitive.
9. **`--changed-within` and `--changed-before`.** Times may be relative
   durations (for example `10h`, `1d`), an RFC 3339 timestamp, a civil
   date-time interpreted in the system time zone, or `@` plus Unix seconds.
   All time constraints must hold (`all`), and a missing modification time
   means the entry is dropped. Both filters use the same parser
   (`TimeFilter::from_str`).
10. **Colorization.** When printing with colors, LS_COLORS styles are computed
    here in parallel with the walk, so the receiver can print without
    extra work.
11. **Send and prune.** The entry is sent to the receiver. With `--prune`, the
    sender then returns `WalkState::Skip` to avoid descending into a matched
    directory.

Sender predicates are evaluated per entry and cannot prune the walk except via
`--prune`. Metadata is cached in `DirEntry` (a `OnceCell`), so several
predicates that need `stat` (owner, size, time, type checks) share one call.

## Broken symlinks

When a symlink target is missing, the walker reports a `NotFound` error. If
the path is itself a symlink, `fd` creates a broken-symlink `DirEntry` and
passes it to the sender like any other entry, so name patterns apply to it.
Whether a `--type` filter keeps it depends on `FileTypes::should_ignore` and
its metadata, which this page does not claim to document. Other walker errors
are forwarded to the receiver and shown only with `--show-errors`.

## Cost ordering

- Walker-level rules run during directory reads and are the most effective at
  reducing work.
- Name and extension checks use only the file name.
- File-type, owner, size and time checks need `stat` or directory reads
  (`--type empty` on a directory reads the directory).
- Colorization is performed only for printed results.

When adding a predicate, place it after name checks and before anything that
requires metadata, unless it is a walker-level rule.

## Extension seams

- New walker-level rules belong in `build_walker`, next to the existing
  `WalkBuilder` options.
- New per-entry predicates belong in the sender closure in `spawn_senders`,
  following the existing order.
- New file types belong in `src/filetypes.rs` and must be recognized in the
  `should_ignore` allow-list so that unknown types are still filtered out.

## Tests

Filter behavior is covered by unit tests in `src/filter/size.rs`,
`src/filter/time.rs` and `src/filter/owner.rs`, and by integration tests in
`tests/tests.rs` that create directory fixtures with hidden files, ignore
<!-- openwiki: broken internal link [/openwiki/testing/integration-tests.md] link "/openwiki/testing/integration-tests.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
files and broken symlinks. See [Testing Strategy](/openwiki/testing/integration-tests.md).

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Parallel Directory Traversal](/openwiki/architecture/parallel-traversal.md)
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)
<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](/openwiki/quickstart.md)
