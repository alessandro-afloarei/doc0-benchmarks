---
title: "Pattern Matching"
---
## Overview

A search pattern given to `fd` goes through three stages before it can match anything: guards that reject likely mistakes, translation of the pattern into regex source text, and compilation into a byte regex. The result is a `Vec<Regex>` that `walk::scan` applies to every entry. [[Startup and Configuration]] shows where these steps sit in `run`; this page covers what each one does.

Sources: [src/main.rs:89-111](repo://src/main.rs#L89-L111)

## Several patterns

The positional pattern and every `--and` expression are collected into one list and translated one by one, with the `--and` expressions first. During the walk an entry must match all of them (`patterns.iter().all(...)`), so extra patterns narrow the result.

Sources: [src/main.rs:90-100](repo://src/main.rs#L90-L100), [src/walk.rs:519-524](repo://src/walk.rs#L519-L524)

## Guard: a path given as a pattern

Without `--full-path`, a pattern is matched against the file name only, so a pattern containing a path separator can never match. `ensure_search_pattern_is_not_a_path` checks the main pattern and each `--and` pattern and returns an error with a suggested fix instead of silently finding nothing. There are two triggers:

Sources: [src/main.rs:169-181](repo://src/main.rs#L169-L181)

- the pattern contains `/`, on every platform;
- on Windows only, it contains the native separator and names an existing directory. The directory check is needed because `\` is also the regex escape character, so patterns like `\d+` must keep working.

Sources: [src/main.rs:185-201](repo://src/main.rs#L185-L201)

The error suggests `fd . 'dir'` to list a directory and `fd --full-path 'dir'` to match whole paths.

Sources: [src/main.rs:203-216](repo://src/main.rs#L203-L216)

## Translating the pattern

`build_pattern_regex` picks the regex source by flag, in this order:

Sources: [src/main.rs:218-231](repo://src/main.rs#L218-L231)

| Flag | Regex source |
| --- | --- |
| `--glob` (and a non-empty pattern) | the regex `globset` generates, with `literal_separator(true)` so `*` does not cross `/` |
| `--exact` | `^` + escaped pattern + `$`: the whole name (or path) must equal it |
| `--fixed-strings` | the escaped pattern, so a substring match |
| none | the pattern unchanged |

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232)

## Compiling

`build_regex` compiles with `regex::bytes::RegexBuilder`, with `case_insensitive` set to the opposite of `Config::case_sensitive` and `dot_matches_new_line(true)`. Working on bytes lets non-UTF-8 file names match. A syntax error is returned with a note pointing to `--fixed-strings`, `--exact` and `--glob`.

Sources: [src/main.rs:541-555](repo://src/main.rs#L541-L555)

## Smart case

`construct_config` computes case sensitivity from the translated patterns, not the raw ones: it is `!ignore_case && (case_sensitive || any pattern has an uppercase character)`. `pattern_has_uppercase_char` parses the pattern with `regex_syntax` and walks the parsed form, looking at literals, character classes, and the contents of groups, repetitions, concatenations and alternations. Only literal characters count, so `\Acargo` or `\x6F` do not turn on case sensitivity but `[a-zA-Z]` does. If the pattern does not parse, the answer is false.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/regex_helper.rs:1-37](repo://src/regex_helper.rs#L1-L37), [src/regex_helper.rs:84-91](repo://src/regex_helper.rs#L84-L91)

## Guard: leading-dot patterns

Hidden files are skipped by default, so a pattern like `^\.gitignore` would find nothing. After the `Config` exists, `ensure_use_hidden_option_for_leading_dot_pattern` returns an error telling the user to add `-H`/`--hidden`. It fires only on Unix, only when hidden files are being ignored, and only if some pattern passes `pattern_matches_strings_with_leading_dot`. That check is deliberately narrow: it matches a start-of-text anchor followed by a literal beginning with `.`, and its source comment says other hidden-only patterns such as `^(\.foo|\.bar)` are not detected.

Sources: [src/main.rs:521-539](repo://src/main.rs#L521-L539), [src/regex_helper.rs:42-79](repo://src/regex_helper.rs#L42-L79)

## What the regex is matched against

For each entry, the sender closure calls `search_str_for_entry`:

Sources: [src/walk.rs:515-524](repo://src/walk.rs#L515-L524)

- By default it returns the final path component (the file name); a path with no file name hits an `unreachable!`, since walks should never produce one.
- With `--full-path`, `Config::full_path_base` holds the current directory. An absolute entry path is used as is; a relative one has any leading `.` removed and is joined onto that base. The pattern then sees an absolute path.

Sources: [src/walk.rs:656-678](repo://src/walk.rs#L656-L678), [src/main.rs:301-308](repo://src/main.rs#L301-L308)

The text is converted to bytes with `filesystem::osstr_to_bytes` before matching. The other filters that run after the pattern check are in [[Entry Filters]].

Sources: [src/walk.rs:519-524](repo://src/walk.rs#L519-L524)

```rust
fn search_str_for_entry_with_relative_path() {
    let full_path_base = Some(Path::new("/home/user"));
    assert_eq!(
        search_str_for_entry(Path::new("./foo/bar"), full_path_base),
        PathBuf::from("/home/user/foo/bar")
    );
}
```

Sources: [src/walk.rs:703-710](repo://src/walk.rs#L703-L710)
