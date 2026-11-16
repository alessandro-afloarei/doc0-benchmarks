---
type: workflow
title: Filtering Entries
description: The ordered chain of checks that decides whether a traversed entry is reported, covering ignore and exclude rules, depth limits, pruning, name patterns, extensions, file types, owner, size, and modification-time constraints, along with how each option is parsed and what happens to entries whose metadata is unavailable.
tags: [filtering, ignore, exclude, depth, file-type, size, time, owner, extension]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
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
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Filtering Entries

Filtering in `fd` happens in two layers. The `ignore` crate decides which directories are
descended into and which files it yields, based on ignore files, hidden-file rules, and
exclude overrides. Then `fd`'s own closure in `src/walk.rs` (`spawn_senders`) applies the
remaining predicates to each yielded entry, in a fixed order, before the entry is sent to
the receiver. This page describes both layers and the order of the `fd` checks. The
threading model that runs these checks is in
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Parallel Traversal](/openwiki/architecture/parallel-traversal.md).

## Layer one: what the walker yields

Configured in `WorkerState::build_walker` and `build_overrides`:

- **Hidden entries** (names beginning with `.`) are skipped unless `-H`/`--hidden` is given.
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  `-u` adds ignore-rule relaxation as described in [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md).
- **Ignore files.** `.fdignore` files are read at every level; `.gitignore`, the global Git
  excludes file, and `.git/info/exclude` are read when VCS ignore handling is on, and by
  default only inside a Git repository (`--no-require-git` removes that requirement).
  Parent-directory ignore files are included unless `--no-ignore-parent`. Custom files from
  `--ignore-file` and the global `fd/ignore` file in the user's config directory are added
  as well.
- **Excludes.** Each `--exclude` pattern is added to an override set rooted at the first
  search path. Excluded directories are not descended into.
- **Depth.** `-d`/`--max-depth` limits how deep the walk descends, `--min-depth` sets the
  shallowest depth that is reported, and `--exact-depth` sets both. Depth 0 is the search
  root itself, which is never reported.
- **Symlinks and devices.** `-L`/`--follow` changes whether symlinked directories are
  traversed. `--one-file-system` stops at mount-point boundaries.

## Layer two: `fd`'s per-entry chain

For each entry the sender closure in `spawn_senders` runs these checks, stopping at the first
failure. Failing entries are dropped with `WalkState::Continue`, so traversal goes on.

1. **Quit flag.** If set, the walk stops with `WalkState::Quit`.
2. **Ignore-contain.** A directory that contains any name given with `--ignore-contain` is
   skipped with `WalkState::Skip`, so its whole subtree is excluded.
3. **Root.** The depth-0 root entry is skipped.
4. **Error conversion.** A `NotFound` error on a symlink becomes a broken-symlink entry;
   other traversal errors are forwarded to the receiver.
5. **Minimum depth.** Entries shallower than `--min-depth` are skipped.
6. **Patterns.** Every compiled pattern must match the search string (name or full path).
<!-- openwiki: broken internal link [/openwiki/concepts/pattern-matching.md] link "/openwiki/concepts/pattern-matching.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   See [Pattern Matching Modes](/openwiki/concepts/pattern-matching.md).
7. **Extensions.** With `-e`/`--extension`, the file name must end in one of the given
   extensions, compared case-insensitively. Leading dots in the values are stripped and the
   extension is matched as a regex suffix.
8. **File types.** With `-t`/`--type`, the entry must match at least one requested type.
   See the table below.
9. **Owner.** On Unix, with `-o`/`--owner`, metadata must be available and match.
10. **Size.** With `-S`/`--size`, only regular files are considered, and every size
    constraint must hold.
11. **Modification time.** With `--changed-within` or `--changed-before`, metadata must be
    available and every constraint must hold.
12. **Styling.** When colored output is on and the entry is being printed, its colors are
    computed here, on the worker thread.
13. **Send and prune.** The entry is sent to the receiver. With `--prune`, the walker then
    returns `WalkState::Skip` for the entry, so matched directories are not descended into.

### File types

`-t` accepts `f`/`file`, `d`/`directory`, `l`/`symlink`, `x`/`executable`, `e`/`empty`,
`b`/`block-device`, `c`/`char-device`, `s`/`socket`, and `p`/`pipe`. `construct_config`
translates them into a `FileTypes` value, with two special rules:

- `executable` implies files as well, and checks the path with `faccess`.
- `empty` alone means "files and directories that are empty". Combined with other types, it
  narrows them. Empty directories are detected by reading the directory; empty files by
  metadata length zero.

An entry whose file type cannot be read is treated as not matching when any type is
requested, because `should_ignore` returns `true` for it.

### Size

`-S` takes a sign and a number with a unit:

- `+` is a minimum (`SizeFilter::Min`), `-` is a maximum, and no sign means an exact
  match.
- Units follow the SI prefixes (`k`, `m`, `g`, `t`, powers of 1000) or the binary prefixes
  (`ki`, `mi`, `gi`, `ti`, powers of 1024). `b` means bytes, and the unit letters are
  case-insensitive.
- Multiple `-S` values must all hold, so `-S +1k -S -10k` selects a range.

Directories and other non-file entries are dropped when any size constraint is given.

### Modification time

`--changed-within` keeps entries modified after a reference, and `--changed-before` keeps
entries modified before it. The reference is parsed in this order:

1. a relative span such as `2weeks`, subtracted from the current time;
2. an RFC 3339 timestamp;
3. a civil date-time, interpreted in the system time zone;
4. `@` followed by Unix seconds.

Invalid values are reported at startup with the message "is not a valid date or duration".

### Owner

`-o user:group` accepts a user name or numeric id and a group name or id. Prefixing either
part with `!` negates it, and an empty part ignores that half. A pair of empty parts is a
no-op and is dropped from `Config`. The owner check needs metadata; if it cannot be read, the
entry is dropped.

## Invariants

- Predicates are conjunctive. An entry must pass every enabled check to be reported.
- A missing metadata value (size, time, owner) is treated as a failure, not a pass.
- The order matters for cost: name checks run before metadata, so large searches do not
  stat every file when a pattern already excludes it.

## Tests

Integration tests in `tests/tests.rs` cover type filters, extension filters, size and time
parsing, and ignore-file behavior. Unit tests in `src/filter/size.rs` and `src/filter/time.rs`
cover parsing and boundary behavior, including the `-1k` and `+1K` cases. See
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Testing Strategy](/openwiki/testing/test-strategy.md).

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Parallel Traversal](/openwiki/architecture/parallel-traversal.md)
<!-- openwiki: broken internal link [/openwiki/concepts/platform-support.md] link "/openwiki/concepts/platform-support.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Platform-Specific Behavior](/openwiki/concepts/platform-support.md)
<!-- openwiki: broken internal link [/openwiki/concepts/pattern-matching.md] link "/openwiki/concepts/pattern-matching.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Pattern Matching Modes](/openwiki/concepts/pattern-matching.md)
