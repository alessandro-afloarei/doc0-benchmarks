---
title: "Format Templates"
---
## Overview

A format template is a string such as `{/}.bak` that `--format`, `--exec` and `--exec-batch` expand once for each path. `FormatTemplate::parse` splits the string into literal text and placeholder tokens when the option is read, and `FormatTemplate::generate` fills the placeholders for one path when a result is printed or a command is built. The template holds no path, so one parsed template serves every result. The printing that calls it is on [[Printing Results]], and the command runner that calls it is on [[Running Commands with --exec]].

Sources: [src/fmt/mod.rs:41-56](repo://src/fmt/mod.rs#L41-L56), [src/fmt/mod.rs:112-141](repo://src/fmt/mod.rs#L112-L141)

## Tokens

There are five placeholder tokens, and each one is a fixed transformation of the path. `{}` is the path itself. `{/}` is its last component. `{//}` is the path's parent, and `{.}` is the path with its extension removed. `{/.}` is the last component with its extension removed.

Sources: [src/fmt/mod.rs:17-39](repo://src/fmt/mod.rs#L17-L39), [src/fmt/mod.rs:118-135](repo://src/fmt/mod.rs#L118-L135)

| Token | Meaning | For `src/main.rs` |
| --- | --- | --- |
| `{}` | the path | `src/main.rs` |
| `{/}` | the last component | `main.rs` |
| `{//}` | the parent directory | `src` |
| `{.}` | the path without its extension | `src/main` |
| `{/.}` | the last component without its extension | `main` |

Sources: [src/fmt/mod.rs:118-135](repo://src/fmt/mod.rs#L118-L135), [src/fmt/input.rs:6-32](repo://src/fmt/input.rs#L6-L32)

The three helpers in `fmt/input.rs` do the work. `basename` returns the file name, or the whole path when there is none. `dirname` returns the parent, and `.` when the parent is empty. `remove_extension` joins the parent and the file stem, and then removes a leading `./`.

Sources: [src/fmt/input.rs:6-32](repo://src/fmt/input.rs#L6-L32)

## Parsing

`parse` looks for the seven patterns `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}` with one Aho-Corasick automaton, built once and kept in a `OnceLock`. The two escape patterns become a single literal brace, so `{{}}` gives the text `{}`, and `{{` gives `{`.

Sources: [src/fmt/mod.rs:51-56](repo://src/fmt/mod.rs#L51-L56), [src/fmt/mod.rs:58-72](repo://src/fmt/mod.rs#L58-L72)

A placeholder that is followed by an extra `}` is kept as literal text, and the extra brace is dropped. A template with no token at all parses to `FormatTemplate::Text`, and its generated value is the same text for every path.

Sources: [src/fmt/mod.rs:76-92](repo://src/fmt/mod.rs#L76-L92), [src/fmt/mod.rs:97-100](repo://src/fmt/mod.rs#L97-L100)

Each match becomes a token through `token_from_pattern_id`, and the text between matches is collected in a buffer and emitted as a `Text` token before the next token. Any unmatched braces are copied through as text.

Sources: [src/fmt/mod.rs:201-211](repo://src/fmt/mod.rs#L201-L211), [src/fmt/mod.rs:101-106](repo://src/fmt/mod.rs#L101-L106)

## Generating for one path

`generate` walks the token list in order and appends each one to an `OsString`. Text tokens are copied as they are. A placeholder token applies its transformation to the path, and then the result goes through `replace_separator`, so the user's `--path-separator` is applied to the transformed value and not to the literal text.

Sources: [src/fmt/mod.rs:112-141](repo://src/fmt/mod.rs#L112-L141)

`replace_separator` returns the path unchanged when no separator was given. Otherwise it walks the path's components. The root directory becomes the separator, and each other component is followed by it except the last. On Windows, a UNC prefix becomes two separators, the server, another separator, and the share. Drive letters are copied as they are.

Sources: [src/fmt/mod.rs:143-196](repo://src/fmt/mod.rs#L143-L196)

Callers pass the path after the `./` prefix has been removed, so the output of `{}` for a file in the search directory has no `./`. The output and the command runner both use `stripped_path`, so they agree on what `{}` means.

Sources: [src/output.rs:69-79](repo://src/output.rs#L69-L79), [src/exec/job.rs:33-39](repo://src/exec/job.rs#L33-L39), [src/dir_entry.rs:56-71](repo://src/dir_entry.rs#L56-L71)

## Where templates are built

`main` parses the `--format` string into a `FormatTemplate` in `construct_config`, and the `--exec` argument lists are parsed by `CommandTemplate::new`, which calls the same parser for each argument. A template that is not an executable is checked there, as described on the command page.

Sources: [src/main.rs:374-377](repo://src/main.rs#L374-L377), [src/exec/mod.rs:219-256](repo://src/exec/mod.rs#L219-L256)
