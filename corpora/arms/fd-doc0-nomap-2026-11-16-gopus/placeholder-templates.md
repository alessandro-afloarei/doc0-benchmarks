---
title: "Placeholder Templates"
---
## Overview

fd has one small template language for turning a found path into text. `--format` uses it to print each result, and every argument of an `--exec` or `--exec-batch` command is one template. A template is parsed once, at start-up, into a `FormatTemplate`; for each result, `generate` expands it against the path and returns an `OsString`, so paths that are not valid UTF-8 survive expansion.

Sources: [src/fmt/mod.rs:41-56](repo://src/fmt/mod.rs#L41-L56), [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141), [src/main.rs:374-377](repo://src/main.rs#L374-L377), [src/exec/mod.rs:219-234](repo://src/exec/mod.rs#L219-L234)

This page covers the syntax and the expansion. How `--format` output is written is on [[Output and Buffering]]; how command templates are validated and run, including the `{}` added when a command has no placeholder, is on [[Command Execution]].

Sources: [src/output.rs:68-86](repo://src/output.rs#L68-L86), [src/exec/mod.rs:250-253](repo://src/exec/mod.rs#L250-L253)

## Placeholders

| Placeholder | Token | Expands to | For `a/folder/file.txt` |
| --- | --- | --- | --- |
| `{}` | `Placeholder` | the path | `a/folder/file.txt` |
| `{/}` | `Basename` | the last component | `file.txt` |
| `{//}` | `Parent` | the parent directory | `a/folder` |
| `{.}` | `NoExt` | the path without its extension | `a/folder/file` |
| `{/.}` | `BasenameNoExt` | the last component without its extension | `file` |
| `{{` | text | a literal `{` | |
| `}}` | text | a literal `}` | |

Sources: [src/fmt/mod.rs:13-39](repo://src/fmt/mod.rs#L13-L39), [src/fmt/mod.rs:236-280](repo://src/fmt/mod.rs#L236-L280)

The path is the one shown to the user, after `./` stripping, so with the default settings `{}` in `--format` is what fd would have printed, without colour or trailing separator.

Sources: [src/output.rs:68-86](repo://src/output.rs#L68-L86), [src/exec/job.rs:33-39](repo://src/exec/job.rs#L33-L39)

## Parsing

`FormatTemplate::parse` scans the string with a single Aho-Corasick automaton over the seven patterns `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}`, built once and kept in a `OnceLock`. It keeps a text buffer and a token list and handles each match by its pattern id:

Sources: [src/fmt/mod.rs:51-67](repo://src/fmt/mod.rs#L51-L67)

1. An escape (`{{` or `}}`, ids 0 and 1): the text up to and including the first brace goes into the buffer, and the second brace is skipped.
2. A placeholder not followed by `}`: the buffer is flushed as a `Token::Text`, then the placeholder's token is pushed.
3. A placeholder followed by `}`: the placeholder is treated as escaped. It goes into the buffer as text, and the extra `}` is dropped, so `{.}}` produces the literal `{.}`.

Sources: [src/fmt/mod.rs:67-92](repo://src/fmt/mod.rs#L67-L92), [src/fmt/mod.rs:199-211](repo://src/fmt/mod.rs#L199-L211)

After the last match the rest of the string is appended to the buffer. If no placeholder token was produced, the result is `FormatTemplate::Text` holding the unescaped string; otherwise the final buffer becomes a last `Text` token and the result is `FormatTemplate::Tokens`. `has_tokens` tells the two apart; the command code uses it to find which argument receives the path.

Sources: [src/fmt/mod.rs:93-107](repo://src/fmt/mod.rs#L93-L107), [src/fmt/mod.rs:53-56](repo://src/fmt/mod.rs#L53-L56)

The tests pin the escape rules: `{{}}` gives `{}`, `{{` gives `{`, `{.}}` gives `{.}`, and `{{{},end}` expanded with `foo` gives `{foo,end}`.

Sources: [src/exec/mod.rs:368-383](repo://src/exec/mod.rs#L368-L383), [src/fmt/mod.rs:218-234](repo://src/fmt/mod.rs#L218-L234)

## Expansion

`generate` walks the tokens and pushes each expansion onto an `OsString`. Text tokens are pushed as they are; every path-derived token goes through `replace_separator` with the configured path separator. A `FormatTemplate::Text` expands to its text whatever the path.

Sources: [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141)

The path parts come from three helpers in `fmt/input.rs`:

Sources: [src/fmt/input.rs:1-32](repo://src/fmt/input.rs#L1-L32)

- `basename` returns the file name, or the whole path when there is none.
- `dirname` returns the parent; an empty parent becomes `.`, and a path with no parent (such as `/`) is returned unchanged.
- `remove_extension` joins `dirname` with the file stem and strips a leading `./`, so `foo.txt` becomes `foo` rather than `./foo`. A hidden name such as `.foo` keeps its dot, because its stem is the whole name.

Sources: [src/fmt/input.rs:6-32](repo://src/fmt/input.rs#L6-L32), [src/fmt/input.rs:56-86](repo://src/fmt/input.rs#L56-L86)

`{/.}` applies `remove_extension` to the basename, and `{.}` applies it to the whole path.

Sources: [src/fmt/mod.rs:121-129](repo://src/fmt/mod.rs#L121-L129)

## Path separator replacement

When `--path-separator` is set (or fd chose `/` under MSYS, see [[Command-Line Options and Config]]), `replace_separator` rebuilds each expanded path from its components instead of doing a string replacement. Without a separator it returns the input borrowed, at no cost.

Sources: [src/fmt/mod.rs:143-153](repo://src/fmt/mod.rs#L143-L153)

- A Windows UNC prefix `\\server\share` becomes two separators, the server, a separator and the share.
- Other Windows prefixes, such as a drive letter `C:`, are written unchanged. Verbatim `\\?\` prefixes are not handled specially; the comment notes they are rare and probably unreachable here.
- The root directory becomes one separator.
- Every other component is written followed by a separator, except the last.

Sources: [src/fmt/mod.rs:154-196](repo://src/fmt/mod.rs#L154-L196)

With `#` as the separator, `foo/bar` becomes `foo#bar` and `/foo/bar/baz` becomes `#foo#bar#baz`. On Windows, `C:\foo\bar` becomes `C:#foo#bar`, `\\server\share\path` becomes `##server#share#path`, and forward slashes count as separators too.

Sources: [src/exec/mod.rs:445-485](repo://src/exec/mod.rs#L445-L485)

Because the path is rebuilt from `Path::components`, the result is the normalized form of the path. Only placeholder output is affected; literal text in the template keeps its own slashes.

Sources: [src/fmt/mod.rs:109-111](repo://src/fmt/mod.rs#L109-L111), [src/fmt/mod.rs:154-157](repo://src/fmt/mod.rs#L154-L157)
