---
type: concept
title: Patterns, traversal, and filters
description: Pattern modes, directory roots, ignore policy, pruning, metadata filters, and a source-based approach to diagnosing missing fd results.
tags: [search, patterns, ignore, filters, filesystem]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:26:52.841Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
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
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "codex", at: "2026-11-16T07:26:52.841Z" }
---

# Patterns, traversal, and filters

`fd [OPTIONS] [pattern] [path]...` searches directory entries by name. To select a directory to search, use a root argument after a pattern, for example `fd . src`. To match directories as part of the candidate string, use `--full-path`. Root selection, candidate matching, and output path formatting are separate decisions.

## Patterns and candidate strings

| Mode | Meaning | Example |
| --- | --- | --- |
| Default regex | Regex match against a filename | `fd '^test_.*\.rs$' tests` |
| `--glob` / `-g` | Compile a glob with literal separators | `fd -g '*.rs' src` |
| `--fixed-strings` / `-F` | Escape regex syntax; allow a literal substring | `fd -F 'test_' tests` |
| `--exact` | Escape and anchor the entire candidate | `fd --exact Cargo.toml` |
| `--and` | Require additional expressions to match the same candidate | `fd foo --and bar` |

The primary pattern and all `--and` patterns use the selected transformation. Every compiled regex must match. Smart case uses uppercase characters in any transformed pattern unless explicitly overridden by `--ignore-case` or `--case-sensitive`. Regexes use the byte API and let `.` match newline. Extension filtering is a separate, always case-insensitive regex set, so multiple `-e` choices are alternatives. [Pattern construction](../../src/main.rs#L94-L109), [transformations and case](../../src/main.rs#L218-L255), [extensions](../../src/main.rs#L361-L373), [matching](../../src/walk.rs#L514-L535).

Normally only the basename is examined. With `--full-path`, fd matches an absolute path, joining relative entries to the working directory cached at startup. This does not itself request absolute output; `--absolute-path` changes root normalization. A slash in any filename-only pattern produces a diagnostic suggesting a root argument or `--full-path`; on Windows, a backslash also triggers that diagnostic when the pattern names an existing directory. [Candidate strings](../../src/walk.rs#L656-L678), [diagnostic](../../src/main.rs#L169-L216).

## Roots and traversal

The default root is `./`. Explicit roots must be directories: invalid ones are diagnosed and dropped; the search continues if any valid roots remain. `--base-directory` changes the process working directory before root resolution. Successful depth-zero entries are suppressed, so a root is not itself returned. [Root resolution](../../src/cli.rs#L696-L735), [startup](../../src/main.rs#L83-L87), [working directory](../../src/main.rs#L131-L147).

`--max-depth` limits walker descent; `--min-depth` suppresses shallow results while allowing descent; `--exact-depth` sets both. `--follow` enables symlink traversal. `--one-file-system` configures filesystem-boundary restriction on supported platforms. A broken symlink recovered from a missing-target walk error has no depth; a minimum-depth filter therefore excludes that recovered entry. [Walker settings](../../src/walk.rs#L352-L365), [symlink recovery and depth](../../src/walk.rs#L485-L512).

## Hidden and ignored entries

Hidden filtering and ignore-file filtering are independent. `-H` reveals hidden entries; `-I` disables normal ignore-file policy; use `-HI` to do both. In this implementation, the unrestricted `-u` alias also disables both policies.

| Control | Effect |
| --- | --- |
| Default | Hidden filtering, `.ignore`/`.fdignore`, Git ignore sources, parent rules, and the fd global ignore file are enabled. Git rules require a Git repository by default. |
| `--no-ignore-vcs` | Disable Git ignore sources while retaining fd ignore rules. |
| `--no-require-git` | Allow Git ignore rules without requiring a Git repository. |
| `--no-ignore-parent` | Disable reading ignore files from parent directories. |
| `--no-global-ignore-file` | Disable the fd global ignore file. |
| `--ignore-file PATH` | Add an explicit ignore file; these are processed even when normal ignore reading is disabled. |
| `--exclude GLOB` | Add a walker override, independent of ignore-file enablement. |

The fd global file is `fd/ignore` beneath the configuration directory chosen by `etcetera`. Config construction selects these controls, while the `ignore` crate resolves the actual walk rules. Malformed custom/global files can print diagnostics without aborting; malformed exclude patterns fail walker construction. [Policy](../../src/main.rs#L310-L320), [ignore loading](../../src/walk.rs#L330-L404). `test_gitignore_and_fdignore` verifies the difference between disabling Git rules and all normal ignore rules. [Test](../../tests/tests.rs#L752-L786).

`--ignore-contain NAME` skips a directory containing that marker and its whole subtree before root and minimum-depth checks. `--prune` instead returns matching entries, then prevents descent beneath them. These solve different tasks: marker exclusion hides the directory itself; pruning preserves the matching directory in results. [Marker handling](../../src/walk.rs#L464-L484), [pruning](../../src/walk.rs#L600-L609), [precedence tests](../../tests/tests.rs#L2829-L2878).

## Metadata filters

Type flags enable entry categories. Executable and empty checks impose additional restrictions; selecting only empty enables files and directories. Unsupported or unavailable file types are rejected when type filtering is active. [Type configuration](../../src/main.rs#L333-L360), [type predicate](../../src/filetypes.rs#L20-L42).

Size constraints apply only to files and are conjunctive. `+1k` means at least 1000 bytes, `-1ki` means at most 1024, and `1b` means exactly one byte. Bounds are inclusive. Time constraints are also conjunctive, with strict before/after comparisons; input accepts relative spans, timestamps, local date-times, and `@` Unix seconds. Missing required metadata rejects the entry. [Size parsing](../../src/filter/size.rs#L15-L74), [time parsing](../../src/filter/time.rs#L28-L62), [filter application](../../src/walk.rs#L557-L591).

On Unix, `--owner` accepts user/group names or numeric IDs in `user:group` form. Either half can be empty or negated with `!`; both active checks must pass. Empty/no-op owner constraints are removed during configuration. [Owner filter](../../src/filter/owner.rs#L24-L101).

## Diagnosing missing results

1. Verify the root with `fd . ROOT`; include `--show-errors` to expose walk errors.
2. Retry with `-HI` to isolate hidden and normal ignore rules. Check explicit excludes, custom ignore files, and marker exclusions separately.
3. Use `-F` for literal substrings, `--exact` for exact names, or `--full-path` for path components. Quote patterns to prevent shell expansion.
4. Remove depth and metadata constraints, then add them back individually. Size filters exclude directories, and unavailable metadata can exclude an otherwise matching entry.

Return to [quickstart](../quickstart.md), inspect the [pipeline](../architecture/search-pipeline.md), or use the [testing guide](../testing/contributor-guide.md) to turn a discrepancy into a regression test.
