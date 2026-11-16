---
title: "Pattern Matching"
---
## Overview

fd decides whether an entry's name matches with byte regexes from the `regex` crate, whatever syntax the user chose. `run` in `src/main.rs` turns the positional pattern and every `--and` pattern into a regex string, lets `construct_config` choose case sensitivity from those strings, checks for patterns that can never match, and compiles them. The compiled `Vec<Regex>` goes to `walk::scan`, and each sender thread tests every entry against all of them.

Sources: [src/main.rs:89-111](repo://src/main.rs#L89-L111)

This page covers the pattern pipeline from string to match. Where the match sits in the per-entry checks, and what runs before and after it, is on [[Parallel Directory Walk]]; the options themselves are parsed as described on [[Command-Line Options and Config]].

Sources: [src/walk.rs:514-524](repo://src/walk.rs#L514-L524)

## From pattern to regex string

The pattern is optional: its default is the empty string, which matches every entry. The `--and` values are chained before the main pattern, and `build_pattern_regex` converts each one according to the matching mode.

Sources: [src/cli.rs:628-639](repo://src/cli.rs#L628-L639), [src/main.rs:94-100](repo://src/main.rs#L94-L100)

| Mode | Flag | Regex string produced |
| --- | --- | --- |
| Glob | `-g`/`--glob` | `globset` regex with `literal_separator(true)`, so `*` does not cross `/` |
| Exact | `--exact` | `^` + escaped pattern + `$` |
| Fixed string | `-F`/`--fixed-strings` | escaped pattern (substring match) |
| Regex | default, `--regex` | the pattern unchanged |

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232)

An empty pattern is never turned into a glob, so `fd -g` with no pattern still matches everything. `--exact` conflicts with both `--glob` and `--fixed-strings`, and its help text states that it matches the entire file name, or the path with `--full-path`. Every `--and` pattern uses the same mode as the main one.

Sources: [src/main.rs:218-221](repo://src/main.rs#L218-L221), [src/cli.rs:187-211](repo://src/cli.rs#L187-L211)

## Smart case

`construct_config` makes the search case-sensitive when `--case-sensitive` is set or any regex string contains an uppercase character, unless `--ignore-case` is set. The check runs on the regex strings, after glob or escape conversion, so it applies to every mode.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255)

`pattern_has_uppercase_char` parses the pattern with `regex_syntax` (UTF-8 mode off, matching the byte regexes) and walks the HIR: a literal counts if any of its characters is uppercase, a character class counts if either end of any range is uppercase, and captures, repetitions, concatenations and alternations recurse. Escapes are therefore not mistaken for literals: `\Acargo` and `carg\x6F` are lowercase, while `foo.[a-zA-Z]` is not. A pattern that fails to parse counts as lowercase.

Sources: [src/regex_helper.rs:4-37](repo://src/regex_helper.rs#L4-L37), [src/regex_helper.rs:90-96](repo://src/regex_helper.rs#L90-L96)

## Diagnostics for patterns that cannot match

### Path separators

Two checks turn a silent "no results" into an error with advice. The first concerns separators: without `--full-path`, fd matches against the file name, so a pattern holding a path separator never matches. `ensure_search_pattern_is_not_a_path` checks the main pattern and every `--and` pattern. A `/` is always flagged, because it is a separator on every platform and has no regex meaning. On Windows a `\` is flagged only if the pattern also names an existing directory, because `\` is the regex escape character there and patterns like `\d+` must still run; the `is_dir` call is skipped when `/` already decided.

Sources: [src/main.rs:149-216](repo://src/main.rs#L149-L216)

The error suggests `fd . 'dir'` to list a directory's contents and `fd --full-path 'pattern'` to match the whole path.

Sources: [src/main.rs:203-212](repo://src/main.rs#L203-L212)

### Leading dot without --hidden

On Unix, if hidden files are being skipped and any regex string only matches names starting with a dot, `ensure_use_hidden_option_for_leading_dot_pattern` fails and suggests `-H/--hidden`. This check runs after `construct_config`, because it needs `config.ignore_hidden`.

Sources: [src/main.rs:102-104](repo://src/main.rs#L102-L104), [src/main.rs:521-539](repo://src/main.rs#L521-L539)

`pattern_matches_strings_with_leading_dot` only detects a concatenation whose first item is a start anchor and whose second is a literal starting with `.`, such as `^\.gitignore`. Its comment notes that other hidden-only patterns like `^(\.foo|\.bar)` are not detected; `^.gitignore` (any character) and `\.gitignore` (unanchored) are not flagged.

Sources: [src/regex_helper.rs:39-79](repo://src/regex_helper.rs#L39-L79), [src/regex_helper.rs:98-105](repo://src/regex_helper.rs#L98-L105)

## Compiling the regexes

`build_regex` compiles each string with `RegexBuilder`, case-insensitive unless the config is case-sensitive, and with `dot_matches_new_line(true)` so `.` also matches a newline in a file name. A compile error is returned with a note pointing to `--fixed-strings`, `--exact` and `--glob` as ways to avoid regex syntax.

Sources: [src/main.rs:541-555](repo://src/main.rs#L541-L555)

## What the pattern is matched against

`search_str_for_entry` picks the string each regex sees. By default it is the entry's file name, so `./foo/bar` is matched as `bar`. With `--full-path`, `construct_config` cached the current directory in `full_path_base`; an absolute entry path is used as-is, and a relative one has its `./` prefix stripped and is joined onto that directory, giving `/home/user/foo/bar`.

Sources: [src/walk.rs:656-678](repo://src/walk.rs#L656-L678), [src/walk.rs:689-744](repo://src/walk.rs#L689-L744), [src/main.rs:301-308](repo://src/main.rs#L301-L308)

The sender converts that string to bytes with `osstr_to_bytes` and requires every regex to match, which is how `--and` works. On Unix the bytes are the raw `OsStr` bytes, so names that are not valid UTF-8 can still match; on Windows the name is converted lossily to UTF-8 first.

Sources: [src/walk.rs:514-524](repo://src/walk.rs#L514-L524), [src/filesystem.rs:102-116](repo://src/filesystem.rs#L102-L116)

## Extensions

`-e`/`--extension` is a separate test, applied after the pattern. Each extension, with leading dots trimmed and regex-escaped, becomes `.\.ext$`, and all of them go into one case-insensitive `RegexSet`. The leading `.` requires at least one character before the dot, so a file named exactly `.rs` does not count as having extension `rs`.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373)

The sender matches the set against the entry's file name, and an entry with no file name is rejected. The option's help notes that it matches every entry type, directories included, and that files without an extension can be found with the pattern `^[^.]+$`.

Sources: [src/walk.rs:526-535](repo://src/walk.rs#L526-L535), [src/cli.rs:380-393](repo://src/cli.rs#L380-L393)
