---
title: "Pattern Matching"
---
## Overview

Every search in fd is a set of regular expressions matched against one string per entry. The positional pattern and each `--and` pattern are translated into regex source, checked for two common mistakes, used to decide case sensitivity, and compiled into `regex::bytes::Regex` values that `walk::scan` hands to every walker thread. An entry is reported only when all of them match. The extension filter (`-e`) is a separate, case-insensitive regex set checked right after.

Sources: [src/main.rs:89-112](repo://src/main.rs#L89-L112), [src/walk.rs:514-535](repo://src/walk.rs#L514-L535)

This page covers the strings that are matched and how patterns are compiled. Where the checks sit in the per-entry loop is on [[Parallel Directory Walk]], and the metadata filters that run afterwards are on [[Entry Filters]].

Sources: [src/walk.rs:508-591](repo://src/walk.rs#L508-L591)

## From pattern to regex source

`run` chains the `--and` patterns with the positional one and passes each through `build_pattern_regex`. The positional pattern defaults to the empty string, which as a regex matches every name; that is why `fd` with no arguments lists everything.

Sources: [src/main.rs:90-100](repo://src/main.rs#L90-L100), [src/cli.rs:628-639](repo://src/cli.rs#L628-L639)

```rust
fn build_pattern_regex(pattern: &str, opts: &Opts) -> Result<String> {
    Ok(if opts.glob && !pattern.is_empty() {
        let glob = GlobBuilder::new(pattern).literal_separator(true).build()?;
        glob.regex().to_owned()
    } else if opts.exact {
        // Anchor the escaped pattern so the full filename (or path) must match exactly.
        // Literal. No substring matching.
        format!("^{}$", regex::escape(pattern))
    } else if opts.fixed_strings {
        // Treat pattern as literal string if '--fixed-strings' is used
        regex::escape(pattern)
    } else {
        String::from(pattern)
    })
}
```

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232)

| Mode | Flag | Regex source | Matches |
| --- | --- | --- | --- |
| Regex | default, `--regex` | the pattern as written | any substring |
| Glob | `-g`, `--glob` | `globset`'s translation, with `literal_separator(true)` | the whole name; `*` and `?` never cross `/` |
| Fixed string | `-F`, `--fixed-strings`, `--literal` | `regex::escape(pattern)` | any substring, literally |
| Exact | `--exact` | `^` + escaped pattern + `$` | the whole name, literally |

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232), [src/cli.rs:153-198](repo://src/cli.rs#L153-L198)

The same mode applies to every `--and` pattern, so `-g` makes all of them globs. An empty glob is not passed to `globset`; it falls through and stays the match-all empty regex.

Sources: [src/main.rs:94-100](repo://src/main.rs#L94-L100), [src/cli.rs:200-211](repo://src/cli.rs#L200-L211)

## Guarding against patterns that cannot match

Without `--full-path`, patterns are matched against the file name alone, so a pattern holding a path separator can never match. `ensure_search_pattern_is_not_a_path` runs before compilation and checks the positional pattern and every `--and` pattern. A `/` always triggers the error, since it is a separator on every platform and has no regex meaning. On Windows a `\` triggers it only when the pattern also names an existing directory, because `\` is the regex escape character there and patterns like `\d+` must still work. The error suggests `fd . 'dir'` or `fd --full-path 'dir'`.

Sources: [src/main.rs:149-216](repo://src/main.rs#L149-L216)

After the `Config` is built, `ensure_use_hidden_option_for_leading_dot_pattern` refuses, on Unix, a search whose pattern only matches names starting with a dot while hidden files are being skipped, because such a search could only return nothing. The detection is deliberately narrow: `pattern_matches_strings_with_leading_dot` parses the regex and returns true only when it is a concatenation that begins with a start anchor followed by a literal starting with `.`. `^\.gitignore` is caught; `^.gitignore`, `\.gitignore` and alternations like `^(\.foo|\.bar)` are not.

Sources: [src/main.rs:521-539](repo://src/main.rs#L521-L539), [src/regex_helper.rs:39-79](repo://src/regex_helper.rs#L39-L79), [src/regex_helper.rs:98-105](repo://src/regex_helper.rs#L98-L105)

## Smart case

The search is case-sensitive when `-s` is given, or when any pattern's regex source contains an uppercase character, unless `-i` is given; `-s` and `-i` override each other, so the last one wins. Because the check runs on the regex source, a glob or fixed string is judged by its translation.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/cli.rs:131-151](repo://src/cli.rs#L131-L151)

`pattern_has_uppercase_char` parses the source with `regex_syntax` (UTF-8 mode off) and walks the HIR: a literal counts if any of its characters is uppercase, a character class counts if any range starts or ends with an uppercase character, and captures, repetitions, concatenations and alternations are searched recursively. Escapes are not literals, so `\Acargo` (start anchor) and `carg\x6F` stay case-insensitive, while `foo.[a-zA-Z]` turns on case sensitivity. A pattern that fails to parse counts as lowercase; the real compile step reports the error.

Sources: [src/regex_helper.rs:4-37](repo://src/regex_helper.rs#L4-L37), [src/regex_helper.rs:81-96](repo://src/regex_helper.rs#L81-L96)

## Compiling the regexes

`build_regex` compiles each source with `RegexBuilder`, setting `case_insensitive` from the config and `dot_matches_new_line(true)` so `.` also matches a newline inside a file name. A syntax error is returned with a note pointing to `--fixed-strings`, `--exact` and `--glob` for users who did not mean to write a regex.

Sources: [src/main.rs:541-555](repo://src/main.rs#L541-L555)

The regexes are byte regexes. Each candidate string is converted with `filesystem::osstr_to_bytes`, which borrows the raw bytes of the `OsStr` on Unix and goes through a lossy UTF-8 conversion on Windows, so names that are not valid UTF-8 still match on Unix.

Sources: [src/filesystem.rs:102-116](repo://src/filesystem.rs#L102-L116)

## What each pattern is matched against

The sender closure calls `search_str_for_entry` for every entry and requires `patterns.iter().all(...)`: every pattern must match the same string, which is how `--and` narrows a search.

Sources: [src/walk.rs:514-524](repo://src/walk.rs#L514-L524)

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
        match entry_path.file_name() {
            Some(filename) => Cow::Borrowed(filename),
            None => unreachable!(
```

Sources: [src/walk.rs:656-671](repo://src/walk.rs#L656-L671)

Without `--full-path` the string is the last path component, borrowed without allocation. With `--full-path` it is an absolute path: absolute entry paths are used as they are, and relative ones have their leading `.` removed and are joined onto `full_path_base`, the working directory read once in `construct_config` (see [[Command-Line Options and Config]]). The unit tests pin these cases: `./foo/bar` under `/home/user` becomes `/home/user/foo/bar`, and without a base it becomes `bar`.

Sources: [src/walk.rs:656-678](repo://src/walk.rs#L656-L678), [src/walk.rs:694-743](repo://src/walk.rs#L694-L743), [src/main.rs:301-308](repo://src/main.rs#L301-L308)

Because a full-path search sees the whole absolute path, a glob such as `**/.git/config` needs `**` to cross directories, and a regex like `foo` matches any entry with `foo` anywhere in its path.

Sources: [src/cli.rs:254-264](repo://src/cli.rs#L254-L264)

## Extension filter

`-e`/`--extension` does not touch the patterns. `construct_config` strips leading dots from each value, escapes it, and builds a `RegexSet` of `.\.<ext>$` patterns, case-insensitive. The leading `.` requires at least one character before the dot, so `-e gitignore` does not match a file named exactly `.gitignore`. Several `-e` values are alternatives.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/cli.rs:380-393](repo://src/cli.rs#L380-L393)

The walker checks the set against the file name only, after the patterns; an entry without a file name is dropped. The extension filter applies to every entry type, including directories whose names end with the extension, unless `--type` narrows it.

Sources: [src/walk.rs:526-535](repo://src/walk.rs#L526-L535), [src/cli.rs:380-385](repo://src/cli.rs#L380-L385)
