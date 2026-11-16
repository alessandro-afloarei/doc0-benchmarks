---
type: concept
title: Matching and metadata filters
description: Pattern compilation, smart case, basename and absolute-path matching, and the combination and failure behavior of fd's metadata filters.
tags: [search, matching, regex, filters, metadata]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:37:15.780Z
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
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "codex", at: "2026-11-16T16:37:15.780Z" }
---

# Matching and metadata filters

Matching happens inside each traversal worker. The walker first decides which entries are reachable; fd then applies filename patterns and metadata constraints. A filename pattern cannot recover a path already excluded by traversal. Diagnose that boundary with [traversal and ignore rules](traversal-and-ignore.md).

## Pattern compilation

The positional pattern defaults to an empty string. `run` combines every `--and` expression with that positional pattern, translates each to regex text, and builds `regex::bytes::Regex` values. Every compiled pattern must match the candidate. An empty expression imposes no additional name restriction.

| Mode | Translation and effect |
| --- | --- |
| Default regex | Use the expression directly; matches may be substrings unless anchored. |
| `--glob` / `-g` | Compile a nonempty glob through `GlobBuilder` with literal path separators; the resulting regex supplies glob semantics. |
| `--fixed-strings` / `-F` | Escape the pattern as a literal substring. |
| `--exact` | Escape and anchor the pattern with `^` and `$`, requiring a complete literal match. |

The CLI declares conflicts/overrides between modes; `build_pattern_regex` receives the resulting options. An empty glob falls through instead of becoming a restrictive glob. Byte regexes enable matching Unix path bytes that are not UTF-8, and regex `.` is configured to match newline bytes. A compile error includes guidance toward literal and glob modes.

```bash
fd 'test.*\.rs$' src
fd -g '*.rs' src
fd -F 'test.' src
fd --exact main.rs src
fd test --and '\.rs$' src
```

Quote patterns to let fd, rather than the invoking shell, interpret metacharacters.

## Smart case and search text

Case is decided once for the whole search. `--ignore-case` forces insensitive matching; otherwise `--case-sensitive` or an uppercase character detected in any translated pattern enables sensitive matching for all patterns. Detection traverses the regex syntax tree, including literals and class ranges. The uppercase `A` in the regex anchor `\A` does not itself activate smart case.

By default the candidate is just `entry_path.file_name()`. `--full-path` caches the working directory during configuration and matches absolute paths: already absolute entries are borrowed, and relative entries are joined to that cached directory after removing a leading `.` component. `--absolute-path` changes root/output representation separately; use `--full-path` when parent directories must participate in matching.

Without full-path mode, startup rejects `/` in the positional or any `--and` pattern and suggests a root directory or full-path search. On Windows it also rejects a pattern containing the native backslash separator when that pattern names an existing directory; other backslashes remain available for regex escapes. On Unix it rejects simple anchored leading-dot expressions while hidden filtering is enabled. This hidden-pattern check recognizes a limited syntax shape, not every regex that can only match hidden files.

## Filter order and combination

After marker-directory and root checks and minimum depth, workers apply these tests in order:

1. All name/path regexes.
2. The extension regex set, when supplied.
3. Selected file types and executable/empty restrictions.
4. Unix owner constraints.
5. All size constraints.
6. All modification-time constraints.

Rejecting early name tests avoids unnecessary metadata reads. The entry caches metadata so later constraints can share it. Failure to obtain required metadata excludes an entry from owner, size, or time matches rather than accepting it on unknown information.

Repeated `--extension` values form alternatives in a case-insensitive `RegexSet`. Leading dots are removed, and escaped values are anchored as suffixes on the filename, allowing compound extensions such as `tar.gz`. Extension filtering is independent of smart case and is not itself a regular-file restriction; combine with `--type f` when necessary.

Repeated ordinary file types enable their categories together. Executable and empty selections additionally constrain acceptance. Executable implies regular-file selection and checks accessibility through `faccess`. Empty on its own enables both files and directories; emptiness is determined by filesystem helpers. Missing or unsupported file types are rejected when type filtering is active.

## Size, time, and owner semantics

Size constraints require a file and usable metadata. A bare quantity such as `11b` means exactly 11 bytes; `+11b` is at least 11 and `-11b` is at most 11. Bounds are inclusive. Decimal `k`, `m`, `g`, `t` units use powers of 1,000; binary `ki`, `mi`, `gi`, `ti` use powers of 1,024. Unit spelling is case-insensitive with optional `b` suffixes for scaled units. Repeating size options intersects bounds:

```bash
fd -t f --size +1ki --size -1mi
fd -t f --changed-within 1day --changed-before 1hour
```

Time options become fixed `SystemTime` boundaries during configuration. The parser tries a relative `jiff::Span` subtracted from now, an absolute timestamp, a civil date/time in the system zone, then an `@`-prefixed unsigned Unix-seconds value. Ambiguous civil times choose the later interpretation. `Before` uses strict `<` and `After` strict `>`; equality does not pass. Entries must have a readable modification time and satisfy every time constraint. Invalid dates/durations fail configuration before scanning.

On Unix, `--owner` accepts a user and optional group separated by `:`. Each component may be a numeric ID or resolved name, blank to ignore that component, or prefixed with `!` to negate it. User and group predicates must both pass. More than one colon, an unknown name, or a failed name lookup returns an error. Empty/no-op owner filters are removed from runtime configuration.

## Extension and verification

A new metadata constraint normally needs CLI parsing, a `Config` field, a pure filter implementation, and application in the worker before sending accepted entries. Preserve the distinction between excluding a result and preventing traversal into its children: ordinary nonmatches continue the walk, while `--prune` acts only after a result passes all filters.

Representative integration coverage includes `test_and_basic`, `test_smart_case`, `test_full_path`, `test_extension`, `test_type`, `test_size`, `test_modified_relative`, and `test_modified_absolute`. Unit tests in `regex_helper`, `filter::size`, `filter::time`, and `filter::owner` cover syntax and boundaries; time tests can supply a thread-local reference clock. See [development and testing](../workflows/development-and-testing.md) for focused commands and [pipeline architecture](../architecture/search-pipeline.md) for producer/consumer ownership.
