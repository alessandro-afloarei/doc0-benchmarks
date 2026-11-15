---
title: "Pattern Matching"
---
## Overview

Every search in fd is a list of byte regular expressions: the positional pattern plus one for each `--and`. `run` builds them in two steps. `build_pattern_regex` turns each pattern into regex source text according to `--glob`, `--exact` or `--fixed-strings`; once `construct_config` has decided case sensitivity from those texts, `build_regex` compiles them. The sender threads then test each entry's file name, or its absolute path with `--full-path`, against all of them.

Sources: [src/main.rs:89-111](repo://src/main.rs#L89-L111)

This page covers the patterns and the match. Where the match sits among the other per-entry checks is on [[Parallel Directory Walk]], and the `-e` extension filter, which is a separate regex set, is on [[Entry Filters]].

Sources: [src/walk.rs:514-535](repo://src/walk.rs#L514-L535)

## From pattern to regex source

`build_pattern_regex` handles one pattern at a time and returns a `String`, choosing the translation from the first mode flag that is set.

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232)

| Mode | Regex source |
| --- | --- |
| `--glob` (non-empty pattern) | `globset` translation with `literal_separator(true)`, so `*` does not cross `/` |
| `--exact` | `^` + escaped pattern + `$`: the whole name must equal the text |
| `--fixed-strings` | escaped pattern: a literal substring |
| default | the pattern unchanged, as a regex |

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232)

The `--and` patterns are chained before the positional pattern and go through the same function, so `--glob` or `--fixed-strings` applies to all of them. An empty pattern stays empty in every mode except `--exact`, and the empty regex matches every name, which is why plain `fd` lists everything.

Sources: [src/main.rs:90-100](repo://src/main.rs#L90-L100), [src/cli.rs:200-211](repo://src/cli.rs#L200-L211)

## Smart case

`construct_config` makes the search case-sensitive when `--ignore-case` is absent and either `--case-sensitive` is given or any pattern's regex source has an uppercase character. Because the check runs on the translated source, it applies equally to globs and fixed strings.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255)

`pattern_has_uppercase_char` parses the regex with `regex_syntax` and walks the syntax tree rather than the raw text. Literals and the ends of character class ranges count; captures, repetitions, concatenations and alternations are searched recursively. Escapes therefore do not trigger case sensitivity: `\Acargo` (the `\A` anchor) and `carg\x6F` are lowercase patterns, while `foo.[a-zA-Z]` is not. A pattern that fails to parse counts as lowercase.

Sources: [src/regex_helper.rs:1-37](repo://src/regex_helper.rs#L1-L37), [src/regex_helper.rs:81-96](repo://src/regex_helper.rs#L81-L96)

## Compiling

`build_regex` compiles each source into a `regex::bytes::Regex`, case-insensitive unless the search is case-sensitive, with `dot_matches_new_line(true)` so `.` also matches a newline inside a file name. A compile error is returned with a note suggesting `--fixed-strings`, `--exact` or `--glob`, since the usual cause is a literal name holding regex metacharacters.

Sources: [src/main.rs:541-555](repo://src/main.rs#L541-L555)

## Friendly errors

### Path separators in the pattern

Without `--full-path` the pattern is matched against a file name, which never contains a separator, so a pattern with one could never match. `ensure_search_pattern_is_not_a_path` checks the positional pattern and every `--and` pattern before any regex is built. A `/` is always flagged, on every platform, because it has no regex meaning. On Windows a `\` is flagged only when the pattern also names an existing directory, because `\` is the regex escape character there and patterns such as `\d+` must still run.

Sources: [src/main.rs:149-216](repo://src/main.rs#L149-L216)

The error message suggests `fd . 'dir'` to list a directory and `fd --full-path 'pattern'` to match whole paths.

Sources: [src/main.rs:203-212](repo://src/main.rs#L203-L212)

### Patterns that only match hidden files

Hidden files are skipped by default, so on Unix fd refuses a pattern that can only match them unless `--hidden` (or `-u`) is set. `pattern_matches_strings_with_leading_dot` recognises only the simplest form: a concatenation starting with a start-of-text anchor followed by a literal beginning with a dot, as in `^\.gitignore`. The code comment notes that patterns such as `^(\.foo|\.bar)` are not detected.

Sources: [src/main.rs:521-539](repo://src/main.rs#L521-L539), [src/regex_helper.rs:39-79](repo://src/regex_helper.rs#L39-L79)

## Matching an entry

### What is matched

For each entry, the sender thread computes the search string with `search_str_for_entry`. Without `--full-path` it is the last path component, `file_name()`. With `--full-path` it is the absolute path: absolute entry paths are used as they are, and relative ones have a leading `.` stripped and are joined onto `full_path_base`, the working directory `construct_config` read once at start.

Sources: [src/walk.rs:656-678](repo://src/walk.rs#L656-L678), [src/main.rs:301-308](repo://src/main.rs#L301-L308)

```rust
fn search_str_for_entry<'a>(
    entry_path: &'a std::path::Path,
    full_path_base: Option<&std::path::Path>,
) -> Cow<'a, OsStr> {
    if let Some(cwd) = full_path_base {
        // If full_path_base is some, that means that we need to return
        // the absolute path
        if entry_path.is_absolute() {
            return Cow::Borrowed(entry_path.as_os_str());
        }
        let path = entry_path.strip_prefix(".").unwrap_or(entry_path);
        Cow::Owned(cwd.join(path).into())
    } else {
```

Sources: [src/walk.rs:656-668](repo://src/walk.rs#L656-L668)

### Bytes, not strings

The search string is converted with `osstr_to_bytes` before matching. On Unix this borrows the raw bytes of the `OsStr`, so names that are not valid UTF-8 are still searchable. On Windows it goes through `to_string_lossy`, so invalid sequences become replacement characters first.

Sources: [src/filesystem.rs:102-116](repo://src/filesystem.rs#L102-L116)

### All patterns must match

An entry passes only if every regex matches; the first miss returns `WalkState::Continue`, which drops the entry but keeps descending into it if it is a directory. The name check runs before the extension, type, owner, size and time filters because it needs no metadata.

Sources: [src/walk.rs:514-524](repo://src/walk.rs#L514-L524)

```rust
if !patterns
    .iter()
    .all(|pat| pat.is_match(&filesystem::osstr_to_bytes(search_str.as_ref())))
{
    return WalkState::Continue;
}
```

Sources: [src/walk.rs:519-524](repo://src/walk.rs#L519-L524)
