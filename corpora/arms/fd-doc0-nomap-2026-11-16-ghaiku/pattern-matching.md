---
title: "Pattern Matching"
---
## Overview

Every pattern the user gives (the positional one and each `--and`) becomes one regular expression before the walk starts. The sender thread then tests each entry's name against all of those expressions, and an entry passes only if every one matches. This page covers how the source text is produced, how case is decided, and what string is tested. [[Startup and Configuration]] covers when these steps run.

Sources: [src/main.rs:94-109](repo://src/main.rs#L94-L109), [src/walk.rs:517-523](repo://src/walk.rs#L517-L523)

## Pattern forms

`build_pattern_regex` chooses one of four forms per pattern. Glob mode is tried first, but only for a non-empty pattern; the empty pattern is the match-everything default and is left alone.

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232)

- `--glob` converts the pattern with `GlobBuilder` and `literal_separator(true)`, so `*` does not cross a `/`.
- `--exact` wraps the escaped text in `^` and `$`, so the whole name must equal the pattern.
- `--fixed-strings` escapes the text and matches it anywhere in the name.
- Otherwise the text is used as a regular expression unchanged.

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232)

The regex is compiled only after `construct_config` has decided case handling, because `build_regex` takes `case_sensitive` from the `Config`. It also sets `dot_matches_new_line(true)`, so a pattern with `.` matches any byte, including a newline in a name.

Sources: [src/main.rs:541-552](repo://src/main.rs#L541-L552)

## Smart case

The case decision is made on the translated regex sources, not on what the user typed, so `--fixed-strings 'Foo'` and `--glob 'Foo*'` also count as containing an uppercase character. `pattern_has_uppercase_char` parses the source with `regex_syntax` and looks for an uppercase character in a literal, in a character class range, or inside a group or repetition. A source that fails to parse is treated as having no uppercase character, so the search falls back to case-insensitive.

Sources: [src/main.rs:251-256](repo://src/main.rs#L251-L256), [src/regex_helper.rs:5-13](repo://src/regex_helper.rs#L5-L13), [src/regex_helper.rs:15-36](repo://src/regex_helper.rs#L15-L36)

`--ignore-case` overrides the decision, and `--case-sensitive` forces it. When the result is case-insensitive, the regex is built with `case_insensitive(true)`.

Sources: [src/main.rs:251-256](repo://src/main.rs#L251-L256), [src/main.rs:541-547](repo://src/main.rs#L541-L547)

## What is tested

By default the regex is run against the file name only. `search_str_for_entry` returns `file_name()` for each entry, so a pattern like `src/lib` never matches a path and is rejected earlier by the pattern check.

Sources: [src/walk.rs:656-683](repo://src/walk.rs#L656-L683), [src/main.rs:169-182](repo://src/main.rs#L169-L182)

With `--full-path`, the `Config` carries the current directory as `full_path_base`, and the tested string is the absolute path. An entry that is already absolute is used as is. A relative entry has any leading `.` removed and is joined to the base, so the pattern sees the same absolute path the user would type.

Sources: [src/walk.rs:656-683](repo://src/walk.rs#L656-L683), [src/main.rs:301-309](repo://src/main.rs#L301-L309)

The string is converted to bytes with `osstr_to_bytes` before matching, because the regex runs on `regex::bytes`. On Unix the raw bytes of the OS string are used, so non-UTF-8 names match exactly; on Windows the name goes through a lossy UTF-8 conversion first.

Sources: [src/filesystem.rs:101-116](repo://src/filesystem.rs#L101-L116)

## Leading-dot patterns

A pattern beginning with `^\.` matches only hidden names, and hidden names are skipped unless `--hidden` is given. `pattern_matches_strings_with_leading_dot` detects only this simplest shape: a start anchor followed by a literal dot. Alternations such as `^(\.a|\.b)` are not detected, so they run without the error.

Sources: [src/regex_helper.rs:38-72](repo://src/regex_helper.rs#L38-L72), [src/main.rs:521-539](repo://src/main.rs#L521-L539)

Once the name has matched, the entry still has to pass the filters described in [[Entry Filters]]; the walk that delivers each candidate is described in [[Directory Walk]].

Sources: [src/walk.rs:523-530](repo://src/walk.rs#L523-L530)
