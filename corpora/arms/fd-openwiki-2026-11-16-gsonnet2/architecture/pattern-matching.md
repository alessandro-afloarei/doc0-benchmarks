---
type: architecture
title: Pattern Compilation and Smart Case
description: How fd converts user patterns (regex, glob, fixed-string, exact, multiple --and) into byte regexes, decides case sensitivity by inspecting the regex HIR, and guards against common mistakes like path-like patterns and leading-dot patterns.
tags: [regex, glob, smart-case, patterns, validation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
sources:
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# Pattern Compilation and Smart Case

Pattern handling is split between `src/main.rs` (conversion and validation) and `src/regex_helper.rs` (regex inspection), with matching performed per entry in `src/walk.rs` (see [[architecture/parallel-walk-pipeline]]).

## From user input to regex

`run` collects the positional pattern plus every `--and` expression (`opts.exprs`) and maps each through `build_pattern_regex`, which picks one conversion in this priority order:

1. **`--glob`** (and non-empty pattern): `globset::GlobBuilder` with `literal_separator(true)`, then the glob's generated regex. With `literal_separator`, `*` does not cross `/`.
2. **`--exact`**: `^` + `regex::escape(pattern)` + `$` — a literal, anchored whole-name (or whole-path) match.
3. **`--fixed-strings`** (alias `--literal`): `regex::escape(pattern)` — a literal substring match.
4. **Otherwise**: the pattern is used as a regular expression.

Conflicts between these modes are declared in clap (see [[architecture/cli-and-config]]). Each result is compiled by `build_regex` into a `regex::bytes::Regex` (so non-UTF-8 names can match), case-insensitive unless the config demands sensitivity, with `dot_matches_new_line(true)`. Compile errors are wrapped with a hint to try `--fixed-strings`, `--exact` or `--glob`.

All patterns must match: the walker requires `patterns.iter().all(...)`, which is how `--and` acts as a conjunction.

## Smart case

`construct_config` makes the search case-sensitive when `--case-sensitive` is given, or when **any** pattern contains an uppercase *literal*, unless `--ignore-case` is set. Detection is `pattern_has_uppercase_char`, which parses the regex with `regex_syntax` (non-UTF-8 mode) and walks the HIR: literals, Unicode/byte classes, captures, repetitions, concatenations and alternations. Checking the HIR rather than raw text means regex escapes do not trigger case sensitivity: `\Acargo`, `\d`, or `carg\x6F` stay case-insensitive, while `foo.[a-zA-Z]` and `foo.EXE` are sensitive. If parsing fails the function returns `false`.

Because glob patterns are converted to regex first, smart case applies to the converted glob text as well.

## What the pattern is matched against

By default the pattern is matched against the entry's **file name** only. With `--full-path` (`-p`), it is matched against the entry's absolute path: the walker uses `config.full_path_base` (the current directory, captured once at startup) joined with the entry path after stripping a leading `./`; absolute entry paths are used as-is. Extensions given via `-e` are matched separately by a case-insensitive `RegexSet` against the file name, so they combine with the pattern.

## Guards that produce friendly errors

**Path-separator guard** (`ensure_search_pattern_is_not_a_path`). Without `--full-path`, a pattern containing `/` can never match a file name, so fd fails with an explanation and two alternatives (`fd . '<dir>'` or `fd --full-path`). The check applies to the primary pattern and every `--and` expression. On Windows, a `\` is only treated as a path separator when the pattern also names an existing directory, because `\` is also the regex escape character (`\d+` must keep working).

**Leading-dot guard** (`ensure_use_hidden_option_for_leading_dot_pattern`). On Unix, when hidden files are filtered and a pattern starts with `^` followed by a literal `.`, fd errors out and suggests `--hidden`, since the search could otherwise never succeed. `pattern_matches_strings_with_leading_dot` deliberately detects only this simple shape (a concatenation whose first element is the start anchor and second a literal beginning with `.`); more complex patterns are not detected.

**Path separator length.** On Windows a custom `--path-separator` must be exactly one byte, with a note about MSYS expanding `/`.

## Edge cases and tests

- An empty pattern matches everything (globs skip conversion for empty patterns).
- Patterns starting with `-` are supported via clap's `--` handling (see `test_and_pattern_starts_with_dash`).
- Unit tests in `regex_helper.rs` cover uppercase and leading-dot detection; integration tests such as `test_smart_case`, `test_glob_searches`, `test_full_path`, `test_and_*`, `test_pattern_with_forward_slash_is_rejected` and `test_error_if_hidden_not_set_and_pattern_starts_with_dot` cover end-to-end behavior (see [[operations/testing]]).
