---
type: concept
title: "Pattern Matching: Regex, Glob, Fixed Strings, and Smart Case"
description: How fd interprets search patterns — default regex, --glob translation, --fixed-strings and --exact escaping, additional --and patterns, smart-case detection through regex-syntax, file-name versus --full-path matching, and the diagnostics that catch common pattern mistakes.
tags: [patterns, regex, glob, smart-case, matching]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Pattern Matching: Regex, Glob, Fixed Strings, and Smart Case

Every fd search has one positional pattern (default `""`, which matches
everything) and optionally more patterns given with `--and`. All are normalized to
regex *source strings*, used to decide case sensitivity, then compiled into
`regex::bytes::Regex` values that the walker threads match against each entry
(`src/main.rs` and `src/walk.rs`).

## Pattern modes

`build_pattern_regex` picks one mode for all patterns:

| Flag | Translation |
| --- | --- |
| *(default)* / `--regex` | The pattern is used verbatim as a Rust `regex` (unanchored, so it matches substrings). |
| `-g/--glob` | `globset::GlobBuilder::new(p).literal_separator(true)` → `glob.regex()`; the resulting regex is anchored, so the glob must match the whole name. An empty pattern stays empty. |
| `-F/--fixed-strings` (`--literal`) | `regex::escape(p)` — literal substring match. |
| `--exact` | `^` + `regex::escape(p)` + `$` — literal whole-name match. |

`--glob` conflicts with `--fixed-strings`; `--exact` conflicts with both.
`--regex` overrides `--glob`. Because `literal_separator(true)` is set, `*` and `?`
in globs do not cross `/`, which matters with `--full-path` (use `**` to span
directories, e.g. `fd --glob --full-path '**/one/**/*.foo'`).

## What is matched

`search_str_for_entry` (in `walk.rs`) decides the haystack:

- **Default:** only the entry's file name (last path component).
- **`-p/--full-path`:** the absolute path. `construct_config` caches
  `env::current_dir()` as `full_path_base`, and relative entry paths are joined to
  it after stripping a leading `./`, avoiding per-entry syscalls.

The haystack is converted to bytes (`filesystem::osstr_to_bytes`): raw bytes on
Unix, so non-UTF-8 file names can be matched; a lossy UTF-8 conversion on Windows.
Regexes are byte regexes built with `dot_matches_new_line(true)` so `.` also
matches newlines in odd file names.

## Multiple patterns (`--and`)

`--and <pattern>` (repeatable) adds patterns that must **all** match the same
haystack (`patterns.iter().all(...)`). They use the same mode as the main pattern
(regex/glob/fixed/exact) and participate in smart case.

## Smart case

Case sensitivity (`Config.case_sensitive`) is:

- off when `-i/--ignore-case` is given;
- otherwise on when `-s/--case-sensitive` is given **or** any pattern string
  contains an uppercase character.

`-s` and `-i` override each other (last wins). Uppercase detection
(`src/regex_helper.rs` `pattern_has_uppercase_char`) parses the pattern with
`regex_syntax` and walks the HIR, looking for uppercase characters in literals
and class range endpoints, recursing through captures, repetitions,
concatenations and alternations. This avoids false positives from regex syntax:
`\Acargo` (anchor) and `carg\x6F` (escaped lowercase) are not uppercase, while
`foo.[a-zA-Z]` is. Unparsable patterns count as having no uppercase. Detection
runs on the translated regex strings, so it also applies to glob and fixed-string
patterns.

## Diagnostics for common mistakes

- **Path in pattern.** Without `--full-path`, a pattern containing `/` can never
  match a file name, so fd errors and suggests `fd . 'dir'` or
  `fd --full-path 'pattern'`. On Windows a pattern with `\` triggers the same
  error only if it names an existing directory, because `\` is also the regex
  escape character (`\d+` must keep working). All `--and` patterns are checked too.
- **Hidden-only pattern.** On Unix, if hidden entries are excluded and a pattern
  starts with `^` followed by a literal `.` (e.g. `^\.gitignore`),
  `pattern_matches_strings_with_leading_dot` detects it and fd suggests `-H`. Only
  that simplest form is detected; `^.gitignore` (unescaped dot) or `\.gitignore`
  (unanchored) are not flagged.
- **Regex syntax errors** are reported with a note recommending `--fixed-strings`,
  `--exact`, or `--glob`.
- **Leading dash.** A pattern starting with `-` must follow `--` (`fd -- -foo`);
  `--and` accepts hyphen-leading values directly.

Extension filtering (`-e`) is separate from pattern matching and always
case-insensitive; see [Entry Filters](entry-filters.md).

## Tests

- `src/regex_helper.rs` unit tests: `pattern_has_uppercase_char_simple/advanced`
  and `matches_strings_with_leading_dot_simple`.
- `tests/tests.rs`: `test_simple`, `test_and_*` (combinations with extension,
  type, glob, fixed strings, case options, full path), `test_full_path_glob_searches`,
  `test_full_path`, `test_pattern_with_forward_slash_allowed_with_full_path`,
  `test_error_if_hidden_not_set_and_pattern_starts_with_dot`, and
  `test_invalid_utf8`.

Related: [Search Pipeline](../architecture/search-pipeline.md),
[Ignore Rules and Hidden Files](ignore-rules-and-hidden-files.md).
