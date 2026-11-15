---
title: "Patterns and Matching"
---
## Overview

Whatever syntax the user picks (regex, glob, literal or exact), fd reduces every pattern to a regular expression string at startup and compiles it into a `regex::bytes::Regex`. The walker then runs one kind of test only: every compiled regex must match the entry's search string, which is its file name, or its absolute path with `--full-path`. Matching on bytes means names that are not valid UTF-8 can still be matched on Unix.

Sources: [src/main.rs:90-109](repo://src/main.rs#L90-L109), [src/walk.rs:514-524](repo://src/walk.rs#L514-L524)

## Pattern kinds

`build_pattern_regex` converts each pattern according to the flags, checked in this order.

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232)

| Flag | Conversion | Example |
| --- | --- | --- |
| `-g`, `--glob` | `globset` glob compiled with `literal_separator(true)`, then its regex | `fd -g '*.rs'` |
| `--exact` | `^` + escaped pattern + `$` | `fd --exact Cargo.toml` |
| `-F`, `--fixed-strings` | Escaped pattern (substring match) | `fd -F 'a+b'` |
| none | The pattern as a regex | `fd '^x.*rc$'` |

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232), [src/cli.rs:153-198](repo://src/cli.rs#L153-L198)

Because the glob is built with `literal_separator(true)`, `*` never matches `/`; use `**` to cross directories with `--full-path`. An empty pattern with `--glob` stays empty, so it still matches everything. `--glob` conflicts with `--fixed-strings`, and `--exact` with both.

Sources: [src/main.rs:218-221](repo://src/main.rs#L218-L221), [src/cli.rs:153-198](repo://src/cli.rs#L153-L198)

## Compiling

`build_regex` compiles each string with `case_insensitive(!config.case_sensitive)` and `dot_matches_new_line(true)`, so `.` also matches a newline inside a file name. A syntax error is returned with a note pointing to `--fixed-strings`, `--exact` and `--glob`, since a failed regex is often a literal the user did not escape.

Sources: [src/main.rs:541-555](repo://src/main.rs#L541-L555)

## Multiple patterns

`--and <pattern>` adds patterns that must also match. Each one goes through the same conversion as the positional pattern, so `--glob` or `--fixed-strings` applies to all of them. The walker checks them with `patterns.iter().all(...)`, so an entry is reported only when every pattern matches its search string.

Sources: [src/main.rs:90-100](repo://src/main.rs#L90-L100), [src/cli.rs:200-211](repo://src/cli.rs#L200-L211), [src/walk.rs:514-524](repo://src/walk.rs#L514-L524)

## Smart case

Unless `-s` or `-i` is given, the search is case-sensitive exactly when some pattern holds an uppercase character. `pattern_has_uppercase_char` parses the regex string with `regex_syntax` and walks the syntax tree, rather than scanning the text, so escapes like `\A` or `\x6F` do not count as uppercase while a class such as `[a-zA-Z]` does. A pattern that fails to parse counts as lowercase.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/regex_helper.rs:1-37](repo://src/regex_helper.rs#L1-L37), [src/regex_helper.rs:81-96](repo://src/regex_helper.rs#L81-L96)

The check runs on the converted regex, after `build_pattern_regex`, so smart case applies the same way to globs and literals.

Sources: [src/main.rs:94-102](repo://src/main.rs#L94-L102)

## Full-path matching

With `-p`/`--full-path`, the search string is the absolute path: `search_str_for_entry` keeps absolute entries and joins relative ones (minus a leading `./`) to the working directory cached in `full_path_base` at startup. A pattern must then describe the full path, such as `fd -p -g '**/.git/config'`.

Sources: [src/walk.rs:656-678](repo://src/walk.rs#L656-L678), [src/main.rs:301-308](repo://src/main.rs#L301-L308)

## Extensions

`-e`/`--extension` is a separate filter, applied after the patterns, and always to the file name. Each extension loses its leading dots, is escaped, and becomes `.\.ext$`; all of them form one case-insensitive `RegexSet`. The leading `.` in the regex requires at least one character before the dot, so `-e gitignore` does not match a file named `.gitignore`. Extensions match directories too unless `--type` restricts the result.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/walk.rs:526-535](repo://src/walk.rs#L526-L535), [src/cli.rs:380-393](repo://src/cli.rs#L380-L393)

## Diagnostics

### Path separators in patterns

Without `--full-path`, a pattern containing a path separator can never match a file name. `ensure_search_pattern_is_not_a_path` checks the positional pattern and every `--and` pattern, and fails with a message that suggests `fd . 'dir'` to list a directory or `fd --full-path 'pattern'`. A `/` is always flagged. On Windows, a `\` is flagged only when the pattern also names an existing directory, because `\` is the regex escape character there and patterns like `\d+` must keep working.

Sources: [src/main.rs:149-216](repo://src/main.rs#L149-L216)

### Patterns for hidden files

On Unix, when hidden files are skipped and a pattern starts with `^\.`, fd fails with a hint to add `-H`, since such a pattern could only match hidden entries. `pattern_matches_strings_with_leading_dot` only detects that simplest shape (a start anchor followed by a literal starting with a dot); alternatives like `^(\.foo|\.bar)` are not caught.

Sources: [src/main.rs:521-539](repo://src/main.rs#L521-L539), [src/regex_helper.rs:39-79](repo://src/regex_helper.rs#L39-L79)
