---
type: concept
title: Pattern Matching
description: How fd turns the search pattern and any --and patterns into byte regexes. Covers regex, --glob, --fixed-strings and --exact modes, smart case detection from the regex syntax tree, filename versus --full-path matching, and the errors fd raises for patterns that could never match.
tags: [patterns, regex, glob, smart-case, full-path, diagnostics]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# Pattern Matching

Every fd search has a primary positional `<pattern>`, which defaults to the empty string and therefore matches everything. It can also have any number of extra patterns given with `--and <pattern>`. **An entry is reported only if every pattern matches it.** The worker closure in `src/walk.rs` checks this with `patterns.iter().all(...)`.

## Pipeline

```
pattern / --and patterns
   │ ensure_search_pattern_is_not_a_path      (main.rs)
   ▼
build_pattern_regex  ──▶ regex source strings
   │                         │
   │                         ├─ smart case → Config.case_sensitive
   │                         └─ leading-dot check (needs Config.ignore_hidden)
   ▼
build_regex  ──▶ regex::bytes::Regex  (case_insensitive = !case_sensitive, dot_matches_new_line)
   ▼
walk: match against file name bytes or absolute path bytes
```

## Pattern modes

`build_pattern_regex` (`src/main.rs`) converts each pattern into regex source. All patterns in one run use the same mode:

| Mode | Flag | Regex source |
| --- | --- | --- |
| Regex (default) | `--regex` overrides an earlier `--glob` | pattern used unchanged |
| Glob | `-g/--glob` | `globset::GlobBuilder::new(p).literal_separator(true)` → `glob.regex()`. With `literal_separator`, `*` and `?` never match `/`, and `**` is needed to cross directories. An empty glob stays empty, so it matches everything |
| Fixed string | `-F/--fixed-strings` (alias `--literal`) | `regex::escape(p)`, a **substring** match |
| Exact | `--exact` | `^` + `regex::escape(p)` + `$`: the whole file name (or the whole path with `--full-path`) must equal the pattern |

`--glob` conflicts with `--fixed-strings`. `--exact` conflicts with both of them. Glob patterns are compiled to regexes too, so every mode shares the same matching and case logic.

## What is matched

`search_str_for_entry(path, full_path_base)` picks the string to match:

- **Default**: only the entry's **file name**, the last path component.
- **`-p/--full-path`**: the **absolute path**. When `--full-path` is set, `construct_config` reads the current directory **once** and stores it in `Config.full_path_base`. Relative walk paths have their leading `.` removed and are joined onto that base. Absolute walk paths are used unchanged. Caching the directory avoids an `env::current_dir()` call for every entry.

The string is turned into bytes with `filesystem::osstr_to_bytes`. On Unix this is zero-copy and keeps non-UTF-8 names. On Windows it is a lossy UTF-8 conversion. Regexes are `regex::bytes::Regex` built with `dot_matches_new_line(true)`, so `.` also matches newline characters inside filenames.

## Case sensitivity (smart case)

`construct_config` computes:

```
case_sensitive = !ignore_case && (case_sensitive_flag || any pattern has an uppercase char)
```

- `-i/--ignore-case` always wins. `-s/--case-sensitive` and `-i` override each other, so whichever comes last applies.
- `regex_helper::pattern_has_uppercase_char` parses each **regex source** with `regex_syntax` and walks the HIR. A pattern counts as having uppercase if it contains an uppercase literal or a character class whose range starts or ends with an uppercase character. Escapes are therefore handled correctly: `\Acargo` and `carg\x6F` are not uppercase, while `foo.[a-zA-Z]` is. If the pattern fails to parse, the answer is "no uppercase".
- The check runs on the regex sources **after** glob conversion or escaping, so smart case works the same way in every mode.
- Case sensitivity is global. One uppercase character in any `--and` pattern makes every pattern case-sensitive.

`--extension` matching is always case-insensitive and does not follow this setting (see [Entry Filters](entry-filters.md)).

## Diagnostics for patterns that can never match

fd fails early, with a helpful message, in these cases:

1. **Path separator in the pattern** (`ensure_search_pattern_is_not_a_path`). Without `--full-path`, any pattern (primary or `--and`) that contains `/` is an error, because file names can't contain `/`. The message suggests `fd . '<dir>'` or `fd --full-path`. On Windows, a pattern that contains `\` is also rejected, but only if it names an **existing directory**. `\` is the regex escape character, so patterns like `\d+` must keep working.
2. **Leading-dot pattern while hidden files are excluded** (Unix only). `pattern_matches_strings_with_leading_dot` detects regexes that start with `^` and then a literal `.`, for example `^\.git`, and fd suggests `-H/--hidden`. Only this simple form is detected.
3. **Invalid regex**: `build_regex` returns the regex error and adds a note that suggests `--fixed-strings`, `--exact`, or `--glob`. Invalid globs fail inside `build_pattern_regex` with the globset error.

A pattern that starts with `-` has to come after `--` (`fd -- -foo`). `--and` uses `allow_hyphen_values`, so its values may start with a dash.

## Tests

`tests/tests.rs`: `test_regex_searches`, `test_smart_case`, `test_case_sensitive`, `test_case_insensitive`, `test_glob_searches`, `test_full_path_glob_searches`, `test_smart_case_glob_searches`, `test_regex_overrides_glob`, `test_full_path`, `test_fixed_strings`, `test_exact_literal_nonsubstring`, the `test_and_*` family, `test_pattern_with_forward_slash_is_rejected`, `test_and_pattern_with_forward_slash_is_rejected`, and `test_error_if_hidden_not_set_and_pattern_starts_with_dot`. Unit tests in `src/regex_helper.rs` and `src/walk.rs` cover HIR inspection and search-string construction.
