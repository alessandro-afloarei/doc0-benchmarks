---
type: concept
title: Pattern Matching
description: How fd turns search patterns into byte regexes — regex, --glob, --fixed-strings and --exact modes, --and patterns, smart case, filename versus --full-path matching, extension matching, and the diagnostics for path-like and dot-only patterns.
tags: [pattern, regex, glob, smart-case, full-path]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# Pattern Matching

Every fd search pattern ends up as a `regex::bytes::Regex`. The conversion happens in `src/main.rs` in two stages, with `Config` construction in between because case sensitivity depends on the converted patterns:

1. `build_pattern_regex(pattern, &opts)` turns each pattern into a **regex string** according to the matching mode.
2. `construct_config` computes smart case from those strings (see [CLI Parsing and Configuration](../architecture/cli-and-configuration.md)).
3. `build_regex(pattern_regex, &config)` compiles each string with `RegexBuilder`, setting `case_insensitive(!config.case_sensitive)` and `dot_matches_new_line(true)`.

The positional pattern and every `--and` pattern go through the same pipeline; the compiled list is handed to [`walk::scan`](../architecture/parallel-walk-and-receiver.md).

## Matching modes

| Mode | Flag | Conversion | Semantics |
|------|------|-----------|-----------|
| Regex (default) | `--regex` to override `--glob` | pattern used as-is | substring regex search (`fd foo` finds `xfoox`) |
| Glob | `-g`, `--glob` | `globset::GlobBuilder` with `literal_separator(true)`, then `glob.regex()` | anchored glob over the whole name; `*` does not cross `/` |
| Fixed strings | `-F`, `--fixed-strings` (alias `--literal`) | `regex::escape(pattern)` | literal substring |
| Exact | `--exact` | `^` + `regex::escape(pattern)` + `$` | the whole file name (or path) must equal the pattern |

Precedence in `build_pattern_regex` is glob → exact → fixed → regex. clap also prevents contradictory combinations: `--glob` conflicts with `--fixed-strings`, and `--exact` conflicts with both. An **empty glob** pattern is not passed to globset but treated as the empty regex, so `fd -g` with no pattern still matches everything.

If a regex fails to compile, the error message suggests `--fixed-strings`, `--exact` or `--glob` as alternatives.

## Multiple patterns (`--and`)

`--and <pattern>` (repeatable) adds patterns that **all** must match: the walker checks `patterns.iter().all(|pat| pat.is_match(...))`. Each additional pattern uses the same mode (glob/fixed/exact/regex) as the primary one.

## What is matched: file name vs full path

`search_str_for_entry` in `src/walk.rs` chooses the haystack:

- **Default:** only the final component (`file_name()`) of the entry path. Directory names are matched the same way when the entry is a directory.
- **`--full-path` / `-p`:** the absolute path. The current directory is captured once in `Config::full_path_base` at startup; relative entry paths have a leading `./` stripped and are joined onto it, and absolute entry paths are used as-is. This is why glob examples like `fd --glob -p '**/.git/config'` work.

The haystack is converted to bytes with `filesystem::osstr_to_bytes` (raw bytes on Unix, lossy UTF-8 on Windows), so non-UTF-8 file names can be matched on Unix.

## Smart case

The search is case-sensitive if `--case-sensitive`/`-s` is given, or if **any** pattern (including `--and` patterns) contains an uppercase character — unless `--ignore-case`/`-i` is given, which always wins. `-s` and `-i` override each other.

Uppercase detection is done on the parsed regex AST in `regex_helper::pattern_has_uppercase_char`, not on the raw string. It walks `regex_syntax` HIR nodes and looks for uppercase characters in literals and character-class bounds. Consequently escapes such as `\A` (start anchor) or `\x6F` don't count as uppercase, while `[a-zA-Z]` does. Unparseable patterns count as "no uppercase". Because the check runs on the converted regex string, it also applies to glob and fixed-string patterns.

## Extension filter

`--extension`/`-e` is a separate filter applied after the name patterns. Each extension (with leading dots trimmed) becomes `.\.<escaped ext>$` in a case-insensitive `RegexSet`, matched against the file name. The leading `.` in the regex requires at least one character before the extension dot, so `-e gitignore` does not match a file named `.gitignore`. Multiple `-e` values are OR-ed. See [Entry Filters](entry-filters.md) for the other filters.

## Diagnostics

### Pattern looks like a path

Without `--full-path`, a pattern containing a path separator can never match a file name. `ensure_search_pattern_is_not_a_path` checks the primary and every `--and` pattern and fails with a message suggesting `fd . '<dir>'` or `fd --full-path '<pattern>'` when:

- the pattern contains `/` (on every platform, since `/` has no regex meaning), or
- on Windows only, it contains `\` **and** names an existing directory (because `\` is also the regex escape character, valid patterns like `\d+` must still run).

### Pattern only matches hidden files

On Unix, if hidden files are being skipped and a pattern's regex begins with a start anchor followed by a literal `.` (e.g. `^\.git`), `regex_helper::pattern_matches_strings_with_leading_dot` detects it and fd aborts with a hint to add `-H/--hidden`. Only this simplest form is detected; patterns such as `^(\.foo|\.bar)` are not. See [Ignore Rules and Hidden Files](ignore-rules-and-hidden-files.md).

## Tests

- `src/regex_helper.rs` unit-tests uppercase and leading-dot detection.
- `src/walk.rs` unit-tests `search_str_for_entry`.
- `tests/tests.rs` covers smart case, `--glob`, `--fixed-strings`, `--exact`, `--and`, `--full-path`, the path-separator diagnostic and the hidden-pattern error (see [Testing](../testing/integration-tests.md)).
