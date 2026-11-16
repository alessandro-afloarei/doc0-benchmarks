---
title: "Pattern Matching"
---
## Overview

Every search pattern, including each `--and` pattern, is turned into one regular expression before the walk starts, and each entry must match all of them to be kept. The regexes are built in `run`, and the walk only calls `is_match` on them. This page covers the rewriting of each pattern, the case rule, the two early checks that reject patterns which cannot match, and the name test the walk applies.

Sources: [src/main.rs:89-110](repo://src/main.rs#L89-L110), [src/walk.rs:517-523](repo://src/walk.rs#L517-L523)

## Rewriting the pattern

`build_pattern_regex` chooses one of four rewrites according to the flags. `--glob` converts the pattern with `globset`, with `literal_separator` set, so that `*` does not cross a `/`. `--exact` anchors the escaped text as `^...$`, and `--fixed-strings` escapes it without anchors. Without any of these flags the pattern is used as the regex text unchanged.

Sources: [src/main.rs:218-231](repo://src/main.rs#L218-L231)

The `--glob` branch skips an empty pattern, which then falls through to the plain branch and becomes the empty regex, which matches every name.

Sources: [src/main.rs:219-223](repo://src/main.rs#L219-L223)

## Smart case

The case rule is decided in `construct_config`. The search is case-sensitive when `--case-sensitive` is given, or when no `--ignore-case` is given and at least one pattern has an uppercase character. `pattern_has_uppercase_char` parses each pattern with `regex-syntax` and looks at its literals and character classes, so `[A-Z]` and `FOO` count, while a pattern like `\d+` does not.

Sources: [src/main.rs:251-256](repo://src/main.rs#L251-L256), [src/regex_helper.rs:5-13](repo://src/regex_helper.rs#L5-L13), [src/regex_helper.rs:15-38](repo://src/regex_helper.rs#L15-L38)

`build_regex` then compiles each pattern with `case_insensitive` set to the opposite of `case_sensitive`, and with `dot_matches_new_line` set, so that `.` also matches a newline inside a name. A pattern that fails to compile is reported with a hint to use `--fixed-strings`, `--exact` or `--glob`.

Sources: [src/main.rs:541-554](repo://src/main.rs#L541-L554)

## Early checks

`ensure_search_pattern_is_not_a_path` runs before the regexes are built. It rejects a pattern containing `/`, because without `--full-path` the walk never matches a path separator in a name, so such a search would print nothing. On Windows it also rejects a `\` only when the pattern names an existing directory, since `\` is also the regex escape character.

Sources: [src/main.rs:149-168](repo://src/main.rs#L149-L168), [src/main.rs:169-205](repo://src/main.rs#L169-L205)

`ensure_use_hidden_option_for_leading_dot_pattern` rejects a pattern that can only match names starting with a dot when hidden entries are filtered out. The detection is deliberately narrow: it recognises only a pattern that starts with the start anchor followed by a literal dot. Other patterns that match hidden names, such as `^(\.foo|\.bar)`, are not detected and are not rejected.

Sources: [src/main.rs:521-536](repo://src/main.rs#L521-L536), [src/regex_helper.rs:40-79](repo://src/regex_helper.rs#L40-L79)

## The name test in the walk

For each entry, `search_str_for_entry` picks the text to test. Without `--full-path` that is the file name alone, and with `--full-path` it is the absolute path, joined from the working directory unless the entry is already absolute and with a leading `./` removed. The walk then requires every regex to match, and drops the entry on the first pattern that fails.

Sources: [src/walk.rs:517-523](repo://src/walk.rs#L517-L523), [src/walk.rs:656-668](repo://src/walk.rs#L656-L668)

The test uses `osstr_to_bytes`, so a name that is not valid UTF-8 is matched on its raw bytes, and the regexes are byte regexes.

Sources: [src/filesystem.rs:103-107](repo://src/filesystem.rs#L103-L107), [src/main.rs:541-546](repo://src/main.rs#L541-L546)

The walk runs the name test first because it needs no metadata, as its comment says. The extension test follows it, and the metadata-based filters run after that; see [[Directory Walk]] for their order and [[Filters]] for each predicate.

Sources: [src/walk.rs:514-523](repo://src/walk.rs#L514-L523), [src/walk.rs:525-530](repo://src/walk.rs#L525-L530)
