---
type: concept
title: "Pattern Matching: Regex, Glob, Fixed, Exact and Smart Case"
description: How fd converts the positional pattern and --and expressions into byte regexes (regex, glob, fixed-string or exact mode), decides case sensitivity by inspecting the regex HIR, matches names versus full paths, and guards against common mistakes.
tags: [regex, glob, smart-case, patterns, matching]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# Pattern Matching: Regex, Glob, Fixed, Exact and Smart Case

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Every pattern ultimately becomes a `regex::bytes::Regex`. The conversion happens in `src/main.rs` in two phases: first to a regex *string* (`build_pattern_regex`), then, after `Config` exists, to a compiled regex (`build_regex`). This ordering matters because smart case needs the regex strings, and `Config.case_sensitive` needs to be known before compilation. See [CLI and config](/openwiki/architecture/cli-and-configuration.md) for the surrounding sequence.

## Pattern sources and combination

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-walk-and-receiver.md] link "/openwiki/architecture/parallel-walk-and-receiver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The pattern list is the `--and` expressions (`opts.exprs`) chained with the positional `pattern`. An entry must match **all** of them (`patterns.iter().all(...)` in the sender closure of [the walker](/openwiki/architecture/parallel-walk-and-receiver.md)). An empty pattern matches everything.

## Conversion modes (`build_pattern_regex`)

Evaluated in this priority:

1. **`--glob`** (non-empty pattern): `globset::GlobBuilder` with `literal_separator(true)` so `*` doesn't cross `/`; the glob's equivalent regex string is used.
2. **`--exact`**: `^<escaped>$`, requiring the entire file name (or path) to equal the pattern literally.
3. **`--fixed-strings`**: the escaped pattern, i.e. literal substring search.
4. Otherwise the pattern is used as a regex verbatim.

Because glob is checked first, `--glob` wins over `--exact`/`--fixed-strings` inside `build_pattern_regex`; `--regex` is a separate flag that clap lets override `--glob` (`test_regex_overrides_glob`), and `test_exact_literal_nonsubstring` covers `--exact`.

## Compilation (`build_regex`)

`RegexBuilder` with `case_insensitive(!config.case_sensitive)` and `dot_matches_new_line(true)` (file names can contain newlines). A compile error is wrapped with a hint to try `--fixed-strings`, `--exact` or `--glob`.

## Smart case

`Config.case_sensitive` is true if `--case-sensitive` is given, or (absent `--ignore-case`) any pattern *regex string* contains a literal uppercase character. Detection (`regex_helper::pattern_has_uppercase_char`) parses the pattern with `regex_syntax` (`utf8(false)` to also accept byte patterns) and walks the HIR: literals, Unicode/byte class ranges, and the sub-expressions of captures, repetitions, concatenations and alternations. This is deliberately more precise than scanning the raw text: `\Acargo` (an anchor escape) and `carg\x6F` do not count as uppercase, while a literal `Foo` or a class like `[a-zA-Z]` does (these cases are asserted in the unit tests). A pattern that fails to parse yields `false` (the real compile error surfaces later). For `--glob` the HIR of the *generated* regex is inspected.

## Name vs. full path

By default each regex is tested against the entry's **file name** only (`search_str_for_entry`), as raw bytes (`osstr_to_bytes`; on Windows a lossy UTF-8 conversion). With `--full-path`, the test string is the absolute path: absolute entries are used as-is, relative ones are joined onto the cwd captured in `Config.full_path_base` after stripping a leading `./`. Extension filtering (`-e`) is always on the file name, regardless of mode.

## Guards against silent empty results

- **Path-like patterns** (`ensure_search_pattern_is_not_a_path`): unless `--full-path` is set, any pattern (positional or `--and`) containing `/` is rejected with a message suggesting `fd . '<dir>'` or `fd --full-path`. On Windows a pattern containing `\` is rejected only if it also names an existing directory, because `\` is a regex escape and patterns like `\d+` must keep working (the `is_dir` syscall is only evaluated when the cheap `/` test fails).
- **Leading-dot patterns with hidden files filtered** (Unix): a pattern that starts with `^` followed by a literal `.` (`pattern_matches_strings_with_leading_dot`) triggers an error recommending `-H`. The detector is intentionally simple and does not catch alternations such as `^(\.foo|\.bar)`.

## Tests

<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/concepts/ignore-and-visibility-rules.md] link "/openwiki/concepts/ignore-and-visibility-rules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`test_regex_searches`, `test_smart_case`, `test_case_sensitive`, `test_case_insensitive`, `test_glob_searches`, `test_full_path_glob_searches`, `test_and_*`, `test_pattern_with_forward_slash_is_rejected`, `test_fixed_strings`, `test_exact_literal_nonsubstring` and `test_error_if_hidden_not_set_and_pattern_starts_with_dot` in `tests/tests.rs`; `regex_helper.rs` has its own unit tests. See [the harness](/openwiki/testing/integration-test-harness.md) and [ignore/visibility rules](/openwiki/concepts/ignore-and-visibility-rules.md) for the hidden-file interaction.
