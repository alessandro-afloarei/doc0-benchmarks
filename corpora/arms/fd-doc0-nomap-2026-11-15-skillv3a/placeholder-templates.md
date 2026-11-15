---
title: "Placeholder Templates"
---
## Overview

`--format`, `--exec` and `--exec-batch` share one small template language: text with placeholders that are replaced by parts of a result's path. `src/fmt` implements it as `FormatTemplate`. A template is parsed once, when the configuration is built, and expanded once per result, so parsing can afford a careful scan while expansion stays a simple walk over tokens. [[Printing Results]] uses a single template for each output line; [[Command Execution]] parses every word of a command as its own template.

Sources: [src/fmt/mod.rs:41-56](repo://src/fmt/mod.rs#L41-L56), [src/main.rs:387-388](repo://src/main.rs#L387-L388), [src/exec/mod.rs:219-256](repo://src/exec/mod.rs#L219-L256)

## Syntax

| Placeholder | Token | Expands to | For `a/folder/file.txt` |
| --- | --- | --- | --- |
| `{}` | `Placeholder` | the path | `a/folder/file.txt` |
| `{/}` | `Basename` | the last component | `file.txt` |
| `{//}` | `Parent` | the parent directory | `a/folder` |
| `{.}` | `NoExt` | the path without its extension | `a/folder/file` |
| `{/.}` | `BasenameNoExt` | the last component without its extension | `file` |
| `{{` | (text) | a literal `{` | `{` |
| `}}` | (text) | a literal `}` | `}` |

Sources: [src/fmt/mod.rs:13-39](repo://src/fmt/mod.rs#L13-L39), [src/fmt/mod.rs:236-280](repo://src/fmt/mod.rs#L236-L280)

The path given to a template is the result as it would be printed, after `./` stripping; see [[Printing Results]] for the stripping rule.

Sources: [src/output.rs:68-78](repo://src/output.rs#L68-L78), [src/exec/job.rs:19-25](repo://src/exec/job.rs#L19-L25)

## Parsing

### The scan

`FormatTemplate::parse` finds the seven markers with one Aho-Corasick automaton, built on first use and kept in the `PLACEHOLDERS` `OnceLock`. The pattern ids follow the order of the list `["{{", "}}", "{}", "{/}", "{//}", "{.}", "{/.}"]`, so `token_from_pattern_id` maps ids 2 to 6 to the five tokens. The parser keeps a text buffer and walks the input from match to match.

Sources: [src/fmt/mod.rs:51-67](repo://src/fmt/mod.rs#L51-L67), [src/fmt/mod.rs:199-211](repo://src/fmt/mod.rs#L199-L211)

- An escape (`{{` or `}}`) appends the text before it plus one brace to the buffer, and skips the second brace.
- A placeholder that is not followed by `}` flushes the buffer as a `Token::Text`, then pushes the placeholder's token.
- A placeholder followed by `}` is taken literally: the placeholder text goes into the buffer and the extra `}` is skipped.

Sources: [src/fmt/mod.rs:67-92](repo://src/fmt/mod.rs#L67-L92)

### The result

When no placeholder was found, `parse` returns `FormatTemplate::Text` holding the input with its escapes resolved; otherwise it returns `FormatTemplate::Tokens`, with the remaining buffer appended as a final text token. `has_tokens` tells the two apart, which is how the command code finds the argument that holds the path.

Sources: [src/fmt/mod.rs:93-107](repo://src/fmt/mod.rs#L93-L107), [src/fmt/mod.rs:53-56](repo://src/fmt/mod.rs#L53-L56)

| Template | Parsed as |
| --- | --- |
| `{{}}` | text `{}` |
| `{.}}` | text `{.}` |
| `{{{},end}` | text `{`, `Placeholder`, text `,end}` |
| `cp` | text `cp` |

Sources: [src/exec/mod.rs:368-383](repo://src/exec/mod.rs#L368-L383)

## Expansion

`generate` takes a path and an optional path separator and builds an `OsString`, so paths that are not valid UTF-8 survive into command arguments unchanged. Text tokens are copied as they are. Each placeholder token computes its part of the path with a helper from `src/fmt/input.rs` and passes it through `replace_separator`. A `Text` template ignores the path and returns its text.

Sources: [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141)

The helpers handle the edge cases of `Path`.

Sources: [src/fmt/input.rs:1-4](repo://src/fmt/input.rs#L1-L4)

| Helper | Rule | Examples |
| --- | --- | --- |
| `basename` | `file_name()`, or the whole path if there is none | `dir/foo.txt` → `foo.txt` |
| `dirname` | `parent()`; an empty parent becomes `.`, no parent keeps the path | `foo.txt` → `.`, `/` → `/` |
| `remove_extension` | `dirname` joined with `file_stem()`, then `./` stripped | `dir/foo.txt` → `dir/foo`, `.foo` → `.foo` |

Sources: [src/fmt/input.rs:6-32](repo://src/fmt/input.rs#L6-L32), [src/fmt/input.rs:56-86](repo://src/fmt/input.rs#L56-L86)

Because `remove_extension` uses `file_stem`, a hidden file such as `.foo` keeps its name, and only the last extension is removed from `archive.tar.gz`. Stripping the `./` added by `dirname` keeps `{.}` of `foo.txt` as `foo` rather than `./foo`.

Sources: [src/fmt/input.rs:11-19](repo://src/fmt/input.rs#L11-L19)

## Custom path separators

When `--path-separator` is set (or defaulted to `/` under MSYS2, see [[Command-Line Options and Configuration]]), `replace_separator` rebuilds each placeholder's value from its `Path` components, joining them with the custom separator. With no custom separator it returns the input borrowed, at no cost. Text tokens are never changed, so a template such as `--format '{}/'` keeps its literal slash.

Sources: [src/fmt/mod.rs:143-196](repo://src/fmt/mod.rs#L143-L196)

Windows prefixes need care. A UNC prefix `\\server\share` is written as two separators, the server, a separator and the share. Other prefixes, such as the drive `C:`, are copied as they are. The root directory always becomes one separator, and every other component is followed by a separator unless it is the last. Verbatim `\\?\` prefixes are not converted, since fd does not produce them in search results.

Sources: [src/fmt/mod.rs:157-195](repo://src/fmt/mod.rs#L157-L195)

| Input (Windows) | With separator `#` |
| --- | --- |
| `C:\foo\bar` | `C:#foo#bar` |
| `\\server\share\path` | `##server#share#path` |
| `C:foo\bar` | `C:foo#bar` |
| `C:/foo/bar` | `C:#foo#bar` |

Sources: [src/exec/mod.rs:459-485](repo://src/exec/mod.rs#L459-L485)
