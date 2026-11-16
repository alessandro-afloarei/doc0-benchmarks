---
title: "Format Templates"
---
## Overview

fd has one placeholder language, used in two places: the `--format` string that replaces how each result is printed, and every argument of an `--exec` or `--exec-batch` command template. `FormatTemplate` in `src/fmt/mod.rs` parses such a string once and later expands it for each path. [[Printing Results]] calls it for `--format`, and [[Command Execution]] builds one per command argument.

Sources: [src/fmt/mod.rs:41-49](repo://src/fmt/mod.rs#L41-L49), [src/main.rs:374-377](repo://src/main.rs#L374-L377), [src/exec/mod.rs:220-256](repo://src/exec/mod.rs#L220-L256)

## Placeholders

| Placeholder | Token | Expands to | For `documents/images/party.jpg` |
| --- | --- | --- | --- |
| `{}` | `Placeholder` | the path | `documents/images/party.jpg` |
| `{/}` | `Basename` | the last component | `party.jpg` |
| `{//}` | `Parent` | the parent directory | `documents/images` |
| `{.}` | `NoExt` | the path without extension | `documents/images/party` |
| `{/.}` | `BasenameNoExt` | the basename without extension | `party` |
| `{{` | text | a literal `{` | |
| `}}` | text | a literal `}` | |

Sources: [src/fmt/mod.rs:13-39](repo://src/fmt/mod.rs#L13-L39), [README.md:219-233](repo://README.md#L219-L233), [src/cli.rs:900-907](repo://src/cli.rs#L900-L907)

The path a template receives is the entry's display path from `stripped_path`, so `{}` matches what fd would print, including the `./` rules described on [[Printing Results]].

Sources: [src/output.rs:68-78](repo://src/output.rs#L68-L78), [src/exec/job.rs:33-39](repo://src/exec/job.rs#L33-L39)

## Parsed form

A template is either `FormatTemplate::Text(String)`, a fixed string with no placeholder, or `FormatTemplate::Tokens(Vec<Token>)`, a sequence of `Token::Text` pieces and placeholder tokens holding at least one placeholder. `has_tokens` tells them apart, and the exec code relies on it: it decides whether a command already has a placeholder, finds the path argument of a batch command, and rejects a placeholder as the `--exec-batch` executable.

Sources: [src/fmt/mod.rs:41-56](repo://src/fmt/mod.rs#L41-L56), [src/exec/mod.rs:136-150](repo://src/exec/mod.rs#L136-L150), [src/exec/mod.rs:220-256](repo://src/exec/mod.rs#L220-L256)

## Parsing

`FormatTemplate::parse` scans the string with an Aho-Corasick automaton over the seven patterns `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}`, built once and kept in the `PLACEHOLDERS` `OnceLock`. Each match is handled by its pattern id.

Sources: [src/fmt/mod.rs:64-92](repo://src/fmt/mod.rs#L64-L92)

- `{{` or `}}` (ids 0 and 1): everything up to and including the first brace goes into the text buffer, and the second brace is skipped.
- A placeholder not followed by `}`: the pending text is flushed as a `Token::Text`, and `token_from_pattern_id` adds the placeholder token.
- A placeholder followed by `}`: the closing brace is escaped, so the placeholder's characters go into the text buffer and the extra `}` is skipped.

Sources: [src/fmt/mod.rs:51-92](repo://src/fmt/mod.rs#L51-L92), [src/fmt/mod.rs:199-211](repo://src/fmt/mod.rs#L199-L211)

After the last match, the rest of the string joins the buffer. If no placeholder token was produced, the result is `Text(buf)`, with escapes already resolved; otherwise the remaining buffer becomes a final `Token::Text`. The code assumes `{` and `}` have the same UTF-8 length, noted as `BRACE_LEN`.

Sources: [src/fmt/mod.rs:58-63](repo://src/fmt/mod.rs#L58-L63), [src/fmt/mod.rs:93-107](repo://src/fmt/mod.rs#L93-L107)

The tests show the escape rules at work.

Sources: [src/fmt/mod.rs:218-280](repo://src/fmt/mod.rs#L218-L280), [src/exec/mod.rs:368-383](repo://src/exec/mod.rs#L368-L383)

| Input | Parsed or generated for `foo` |
| --- | --- |
| `This string only has escapes like {{ and }}` | `Text("This string only has escapes like { and }")` |
| `{{}}` | `{}` |
| `{.}}` | `{.}` |
| `{{{},end}` | `{foo,end}` |
| `{{path={} basename={/} ... }}` | `Text("{path=")`, `Placeholder`, `Text(" basename=")`, `Basename`, ... `Text(" }")` |

Sources: [src/fmt/mod.rs:227-263](repo://src/fmt/mod.rs#L227-L263), [src/exec/mod.rs:368-383](repo://src/exec/mod.rs#L368-L383)

## Expansion

`generate(path, path_separator)` returns an `OsString`. A `Text` template returns its text unchanged. For `Tokens`, each token appends to the output: `Text` pieces as written, and each placeholder as its path transformation passed through `replace_separator`. Working with `OsString` keeps paths that are not valid UTF-8 intact for commands; `--format` output converts the result lossily to a string afterwards.

Sources: [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141), [src/output.rs:79-80](repo://src/output.rs#L79-L80)

The transformations come from `src/fmt/input.rs`.

Sources: [src/fmt/input.rs:6-32](repo://src/fmt/input.rs#L6-L32)

- `basename` returns `file_name()`, or the whole path when there is none.
- `dirname` returns the parent, `.` when the parent is empty (`foo.txt` gives `.`), and the path itself when there is no parent (`/` gives `/`).
- `remove_extension` joins `dirname` with `file_stem`, then strips a leading `./`, so `foo.txt` becomes `foo`, `dir/foo.txt` becomes `dir/foo`, and a hidden file such as `.foo` is unchanged.
- `{/.}` applies `remove_extension` to the basename.

Sources: [src/fmt/input.rs:1-32](repo://src/fmt/input.rs#L1-L32), [src/fmt/input.rs:56-86](repo://src/fmt/input.rs#L56-L86), [src/fmt/mod.rs:121-125](repo://src/fmt/mod.rs#L121-L125)

## Custom path separators

When `--path-separator` is set, placeholders are rebuilt with that separator; fixed text is never changed. `replace_separator` returns the input borrowed when no separator is set. Otherwise it iterates over the path's components.

Sources: [src/fmt/mod.rs:147-157](repo://src/fmt/mod.rs#L147-L157)

- A UNC prefix `\\server\share` becomes separator, separator, server, separator, share.
- Any other Windows prefix, such as a drive letter `C:`, is copied as-is; the comment explains that verbatim `\\?\` prefixes are deliberately not handled because they are rare and users can post-process with `sed`.
- The root directory becomes one separator.
- Every other component is copied, followed by a separator unless it is the last.

Sources: [src/fmt/mod.rs:143-196](repo://src/fmt/mod.rs#L143-L196)

On Unix, with `#` as the separator, `foo/bar` becomes `foo#bar` and `/foo/bar/baz` becomes `#foo#bar#baz`. On Windows, `C:\foo\bar` becomes `C:#foo#bar`, `\\server\share\path` becomes `##server#share#path`, and forward slashes are normalized as separators too. Plain and coloured output instead replace separator characters in the string ([[Printing Results]]).

Sources: [src/exec/mod.rs:445-485](repo://src/exec/mod.rs#L445-L485), [src/output.rs:12-14](repo://src/output.rs#L12-L14)
