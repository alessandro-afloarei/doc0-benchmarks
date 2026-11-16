---
title: "Pattern Matching"
---
## Overview

fd matches every entry against one or more compiled regexes: the positional pattern and each `--and` pattern. Whatever syntax the user chose (regex, glob, literal or exact), `run` first converts each pattern to a regex source string, then compiles all of them with the same options once `Config` knows whether the search is case-sensitive. An entry is a match only when every regex matches.

Sources: [src/main.rs:89-111](repo://src/main.rs#L89-L111), [src/walk.rs:514-524](repo://src/walk.rs#L514-L524)

This two-step order exists because smart case is decided from the regex source strings, and `construct_config` needs that decision ([[Command-Line Parsing and Configuration]]). The extension filter is a separate regex set and is also covered here; the other filters are on [[Entry Filters]].

Sources: [src/main.rs:94-109](repo://src/main.rs#L94-L109), [src/main.rs:248-255](repo://src/main.rs#L248-L255)

## Pattern sources

The positional `pattern` defaults to the empty string, which matches every entry. `--and` adds further patterns, each of which must also match; they are interpreted with the same syntax flag as the main pattern. `run` chains the `--and` patterns before the positional one and maps each through `build_pattern_regex`.

Sources: [src/cli.rs:200-211](repo://src/cli.rs#L200-L211), [src/cli.rs:628-639](repo://src/cli.rs#L628-L639), [src/main.rs:90-100](repo://src/main.rs#L90-L100)

## Pattern syntax

`build_pattern_regex` picks the conversion from the syntax flags, in this order:

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232)

| Flag | Conversion | Effect |
| --- | --- | --- |
| `--glob` / `-g` (non-empty pattern) | `GlobBuilder::new(pattern).literal_separator(true)`, then `glob.regex()` | `*` and `?` do not cross `/`; the glob must match the whole name |
| `--exact` | `^` + `regex::escape(pattern)` + `$` | literal, whole-name match |
| `--fixed-strings` / `-F` / `--literal` | `regex::escape(pattern)` | literal substring |
| none, or `--regex` | the pattern as written | regex, substring unless anchored |

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232), [src/cli.rs:153-198](repo://src/cli.rs#L153-L198)

`--glob` conflicts with `--fixed-strings`, `--exact` conflicts with both, and `--regex` overrides `--glob`, so at most one conversion applies. An empty pattern with `--glob` is not handed to the glob builder and stays the empty, match-all regex.

Sources: [src/cli.rs:153-198](repo://src/cli.rs#L153-L198), [src/main.rs:219-221](repo://src/main.rs#L219-L221)

## Smart case

The search is case-insensitive unless the pattern contains an uppercase character. `pattern_has_uppercase_char` parses the regex source with `regex_syntax` (with `utf8(false)`, so byte-oriented patterns parse) and walks the resulting `Hir`: it looks for uppercase characters in literals and at the ends of character-class ranges, recursing into captures, repetitions, concatenations and alternations. A pattern that fails to parse counts as having none.

Sources: [src/regex_helper.rs:1-36](repo://src/regex_helper.rs#L1-L36)

Because the check runs on the parsed regex and not on the text, escapes and anchors do not trigger case sensitivity: `\Acargo` and `carg\x6F` stay case-insensitive, while `foo.[a-zA-Z]` becomes case-sensitive through its class range. With `--glob`, the check sees the translated glob regex.

Sources: [src/regex_helper.rs:81-96](repo://src/regex_helper.rs#L81-L96), [src/main.rs:94-100](repo://src/main.rs#L94-L100)

`construct_config` makes the final decision: `--ignore-case` forces case-insensitive, otherwise `--case-sensitive` or an uppercase character in any pattern makes the search case-sensitive. The two flags override each other, so the last one given wins.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/cli.rs:130-151](repo://src/cli.rs#L130-L151)

## Diagnostics before the search

### Pattern that looks like a path

Two checks stop fd with an explanation when a pattern cannot produce the results the user expects. The first runs before `Config` exists. Without `--full-path`, patterns are matched against file names only, so a pattern that contains a path separator can never match. `ensure_search_pattern_is_not_a_path` checks the positional pattern and every `--and` pattern. A `/` always triggers the error, since it has no regex meaning. On Windows a `\` triggers it only when the pattern also names an existing directory, because `\` is the regex escape character and patterns like `\d+` must still run. The error message suggests `fd . 'dir'` to list a directory and `fd --full-path` to match paths.

Sources: [src/main.rs:149-216](repo://src/main.rs#L149-L216)

### Pattern that only matches hidden files

On Unix, when hidden files are being skipped, `ensure_use_hidden_option_for_leading_dot_pattern` fails if a pattern can only match names starting with a dot, and suggests `-H/--hidden`. `pattern_matches_strings_with_leading_dot` detects only the simplest form: a concatenation that begins with a start anchor followed by a literal starting with `.`, as in `^\.gitignore`. `^.gitignore` (any character) and `\.gitignore` (unanchored) pass.

Sources: [src/main.rs:521-539](repo://src/main.rs#L521-L539), [src/regex_helper.rs:38-78](repo://src/regex_helper.rs#L38-L78), [src/regex_helper.rs:97-104](repo://src/regex_helper.rs#L97-L104)

## Compiling the regexes

`build_regex` compiles each source string as a `regex::bytes::Regex`, so it can match file names that are not valid UTF-8. It sets `case_insensitive(!config.case_sensitive)` and `dot_matches_new_line(true)`, so `.` also matches a newline inside a file name. A compile error is returned with a note pointing at `--fixed-strings`, `--exact` and `--glob` for users who did not mean to write a regex.

Sources: [src/main.rs:541-555](repo://src/main.rs#L541-L555)

## Matching an entry

In the walker callback, after the depth checks, `search_str_for_entry` picks the string to match. Without `--full-path` it is the entry's file name. With `--full-path` it is the absolute path: absolute entry paths are used as they are, and relative ones have a leading `.` stripped and are joined to `full_path_base`, the current directory cached once in `Config` so no entry needs a `current_dir` call.

Sources: [src/walk.rs:514-524](repo://src/walk.rs#L514-L524), [src/walk.rs:656-678](repo://src/walk.rs#L656-L678), [src/main.rs:301-308](repo://src/main.rs#L301-L308)

The string is converted to bytes with `osstr_to_bytes`, which borrows the raw bytes on Unix and uses a lossy UTF-8 conversion on Windows. If any regex fails to match, the callback returns `WalkState::Continue`: the entry is dropped but, if it is a directory, the walk still descends into it. The name check comes before every filter that needs metadata.

Sources: [src/filesystem.rs:102-116](repo://src/filesystem.rs#L102-L116), [src/walk.rs:519-524](repo://src/walk.rs#L519-L524)

```rust
if !patterns
    .iter()
    .all(|pat| pat.is_match(&filesystem::osstr_to_bytes(search_str.as_ref())))
{
    return WalkState::Continue;
}
```

Sources: [src/walk.rs:519-524](repo://src/walk.rs#L519-L524)

## Extension filter

`--extension` is applied right after the patterns. `construct_config` strips a leading `.` from each value, escapes it and builds a case-insensitive `RegexSet` of `.\.ext$` patterns. The walker matches the set against the file name; an entry with no file name, or whose name matches none of the extensions, is skipped. The leading `.` in the pattern requires at least one character before the extension, so a file named `.md` is not an `md` file.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/walk.rs:526-535](repo://src/walk.rs#L526-L535)

The extension filter matches every entry type, including directories whose names end with the extension; combine it with `--type` to restrict it ([[Entry Filters]]). To find files with no extension, the option's help suggests the regex `^[^.]+$` as the pattern.

Sources: [src/cli.rs:380-393](repo://src/cli.rs#L380-L393)
