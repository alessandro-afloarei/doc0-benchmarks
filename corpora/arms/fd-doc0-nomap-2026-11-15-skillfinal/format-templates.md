---
title: "Format Templates and Placeholders"
---
## Overview

`--format`, `--exec` and `--exec-batch` share one small template language: text with placeholders that expand to parts of a result's path. `src/fmt` holds it. `FormatTemplate::parse` turns a string into a `FormatTemplate` once, when the options are processed, and `FormatTemplate::generate` expands it for each result path. `--format` parses its whole value as one template; a command parses each argument as its own template, so a placeholder never splits or joins command-line arguments.

Sources: [src/fmt/mod.rs:41-58](repo://src/fmt/mod.rs#L41-L58), [src/main.rs:374-377](repo://src/main.rs#L374-L377), [src/exec/mod.rs:219-234](repo://src/exec/mod.rs#L219-L234)

For `--format` the expansion is converted to a string and printed in place of the path (see [[Output Formatting]]); for a command, each expanded argument is passed to the process as one argument (see [[Command Execution]]).

Sources: [src/output.rs:68-86](repo://src/output.rs#L68-L86), [src/exec/mod.rs:262-272](repo://src/exec/mod.rs#L262-L272)

## Placeholders

| Placeholder | `Token` | Expands to | For `a/folder/file.txt` |
| --- | --- | --- | --- |
| `{}` | `Placeholder` | the path | `a/folder/file.txt` |
| `{/}` | `Basename` | the last component | `file.txt` |
| `{//}` | `Parent` | the parent directory | `a/folder` |
| `{.}` | `NoExt` | the path without its extension | `a/folder/file` |
| `{/.}` | `BasenameNoExt` | the last component without its extension | `file` |
| `{{` | text | a literal `{` | |
| `}}` | text | a literal `}` | |

Sources: [src/fmt/mod.rs:13-39](repo://src/fmt/mod.rs#L13-L39), [src/fmt/mod.rs:236-280](repo://src/fmt/mod.rs#L236-L280)

The path given to a template is the stripped path the user would see, without a leading `./` when `strip_cwd_prefix` is on (see [[Output Formatting]]).

Sources: [src/output.rs:75-78](repo://src/output.rs#L75-L78), [src/exec/job.rs:34-39](repo://src/exec/job.rs#L34-L39)

## Parsing

### The scan

`parse` searches the input with an Aho-Corasick automaton built once (in a `OnceLock`) over the seven strings `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}`. Literal text collects in a buffer. For each match:

Sources: [src/fmt/mod.rs:58-67](repo://src/fmt/mod.rs#L58-L67)

1. An escape, `{{` or `}}`, adds a single brace to the buffer.
2. A placeholder not followed by `}` pushes the buffer as a `Token::Text` (when non-empty) and then the placeholder's token.
3. A placeholder followed by `}` is read as an escaped closing brace: the placeholder's characters go into the buffer as text, and the extra `}` is skipped.

Sources: [src/fmt/mod.rs:58-92](repo://src/fmt/mod.rs#L58-L92), [src/fmt/mod.rs:199-211](repo://src/fmt/mod.rs#L199-L211)

### The result

If no placeholder was found, `parse` returns `FormatTemplate::Text` with the escapes resolved, and `has_tokens()` is false. Otherwise the remaining text becomes a final `Token::Text` and the result is `FormatTemplate::Tokens`. Command templates use `has_tokens` to tell whether an argument holds a placeholder.

Sources: [src/fmt/mod.rs:93-107](repo://src/fmt/mod.rs#L93-L107), [src/fmt/mod.rs:53-56](repo://src/fmt/mod.rs#L53-L56)

| Input | Parsed as | Expanded for `foo` |
| --- | --- | --- |
| `{{}}` | text | `{}` |
| `{{` | text | `{` |
| `{.}}` | text | `{.}` |
| `{{{},end}` | `{`, `{}`, `,end}` | `{foo,end}` |
| `{/.}.ext` | `{/.}`, `.ext` | `foo.ext` |

Sources: [src/exec/mod.rs:368-403](repo://src/exec/mod.rs#L368-L403)

## Expansion

### generate

`generate(path, path_separator)` returns an `OsString`, so non-UTF-8 paths survive into command arguments. A `Text` template returns its text. A `Tokens` template appends each token in order: `Text` tokens as written, and path tokens computed by the helpers below and passed through `replace_separator`. A custom separator therefore changes only the expanded path parts, never the literal text of the template.

Sources: [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141)

### Path helpers

`basename` is the path's `file_name`, or the whole path when there is none. `dirname` is the parent, `.` when the parent is empty (a bare file name), or the path itself for a root. `remove_extension` joins the parent and the `file_stem` and strips a leading `./`, so `foo.txt` becomes `foo`, `dir/foo.txt` becomes `dir/foo`, and the hidden name `.foo` stays `.foo`.

Sources: [src/fmt/input.rs:1-32](repo://src/fmt/input.rs#L1-L32), [src/fmt/input.rs:56-73](repo://src/fmt/input.rs#L56-L73)

## Custom path separators

### replace_separator

With `--path-separator`, `replace_separator` rebuilds a path from its `Path::components`. Without one it returns the input borrowed, at no cost. Normal components are joined with the separator, and a root directory becomes the separator itself, so with `#` the path `/foo/bar/baz` becomes `#foo#bar#baz`.

Sources: [src/fmt/mod.rs:143-196](repo://src/fmt/mod.rs#L143-L196), [src/exec/mod.rs:445-457](repo://src/exec/mod.rs#L445-L457)

### Windows prefixes

A UNC prefix `\\server\share` is written as two separators, the server, a separator and the share. Other prefixes, such as a drive letter, are kept as they are. The code comments say verbatim `\\?\` prefixes are left alone because they are rare and maybe unreachable here.

Sources: [src/fmt/mod.rs:157-181](repo://src/fmt/mod.rs#L157-L181)

| Input (Windows) | With separator `#` |
| --- | --- |
| `C:\foo\bar` | `C:#foo#bar` |
| `\\server\share\path` | `##server#share#path` |
| `C:foo\bar` | `C:foo#bar` |
| `C:/foo/bar` | `C:#foo#bar` |

Sources: [src/exec/mod.rs:459-485](repo://src/exec/mod.rs#L459-L485)
