---
type: concept
title: Pattern Matching Modes
description: How fd interprets its search patterns as regular expressions by default, or as glob, exact, or fixed-string patterns, and how smart case, the --and conjunction, --full-path matching, and the path-separator and leading-dot guards affect which entries match.
tags: [patterns, regex, glob, smart-case, full-path, matching]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Pattern Matching Modes

Every `fd` search reduces to one or more regular expressions compiled with the `regex`
crate's byte API. The mode flags only decide how the user's text becomes a regex source.
Once compiled, every pattern is tested against the same thing: the entry's file name, or
its absolute path when `--full-path` is set. This page explains the translation rules and
the surrounding behavior. The code lives in `src/main.rs` (translation and guards),
`src/regex_helper.rs` (case and leading-dot analysis), and `src/walk.rs` (matching).

## Translation modes

Each pattern is translated by `build_pattern_regex`. The checks are ordered:

1. **Glob** (`--glob`, `-g`). Applied to non-empty patterns. The glob is compiled with
   `literal_separator(true)`, so `*` never crosses a `/`. Use `**` to span directories
   with `--full-path`.
2. **Exact** (`--exact`). The regex-escaped text is anchored with `^` and `$`, so the whole
   name must equal the pattern.
3. **Fixed strings** (`--fixed-strings`, `-F`). The text is regex-escaped and matched as a
   substring.
4. **Regex** (default). The text is used as-is. Invalid syntax fails startup, with a hint
   to try `--fixed-strings`, `--exact`, or `--glob`.

Modes apply to all patterns in one invocation. For example, `fd --glob foo '*.rs'` treats
both the primary pattern and any `--and` values as globs.

## Smart case

Matching is case-insensitive unless `--case-sensitive` is given or a pattern contains an
uppercase literal or a character-class bound with an uppercase character. The check runs
on the parsed regex, so a lowercase pattern such as `readme` stays insensitive while
`README` becomes sensitive. `--ignore-case` overrides everything. Smart case considers all
patterns together: an uppercase letter in any `--and` value makes the whole search
case-sensitive. The tests `test_smart_case`, `test_case_sensitive`, and
`test_case_insensitive` in `tests/tests.rs` pin these cases.

## Conjunction with `--and`

The positional pattern and each `--and` value are separate regexes. An entry is kept only if
every regex matches the same target. `walk.rs` implements this with `all` over the compiled
list. This is the mechanism behind combinations such as `fd baz --and quux`. Patterns that
start with `-` are accepted in `--and` because the option allows hyphen values.

## Matching target

- **Default**: the file name (or directory name) of the entry. Paths are never matched by
  default, which is why a pattern containing `/` is rejected at startup with a message that
  suggests `fd . '<dir>'` or `--full-path`.
- **`--full-path` / `-p`**: the absolute path. `search_str_for_entry` joins relative paths
  onto the current directory, strips a leading `./`, and returns absolute paths unchanged.
  Combine it with `--glob` for patterns such as `**/.git/config`.

## Guards

Two checks in `src/main.rs` turn likely mistakes into errors before traversal starts:

- **Path separator in a pattern.** Without `--full-path`, any pattern containing `/` is
  refused. On Windows, a `\` is refused only when the pattern names an existing directory,
  because `\` is also a regex escape.
- **Leading dot without hidden files.** On Unix, a pattern recognized as `^\.` fails when
  hidden entries are excluded, and the message suggests `-H`. Detection covers that simplest
  form only.

## Invariants and gotchas

- The regex engine is the single matching backend. Glob and fixed-string modes do not use
  separate code paths, so behavior differences come only from the translation step.
- The matcher operates on bytes (`regex::bytes`), so non-UTF-8 file names still match
  against byte patterns.
- Matching does not sort or rank results; the output order is covered in
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  [Parallel Traversal](/openwiki/architecture/parallel-traversal.md).

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)
<!-- openwiki: broken internal link [/openwiki/workflows/filtering-entries.md] link "/openwiki/workflows/filtering-entries.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Filtering Entries](/openwiki/workflows/filtering-entries.md)
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Testing Strategy](/openwiki/testing/test-strategy.md)
