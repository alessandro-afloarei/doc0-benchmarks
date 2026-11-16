---
title: "Placeholder Templates"
---
## Overview

`--format` and every argument of `--exec`/`--exec-batch` are templates: text with placeholders that are replaced by parts of a result's path. The `fmt` module parses such a string once, at startup, into a `FormatTemplate`, and expands it per result with `generate`. The same type serves both features, so the placeholder rules are identical for printing ([[Printing Results]]) and for commands ([[Command Execution]]).

Sources: [src/fmt/mod.rs:41-58](repo://src/fmt/mod.rs#L41-L58), [src/main.rs:374-377](repo://src/main.rs#L374-L377), [src/exec/mod.rs:219-234](repo://src/exec/mod.rs#L219-L234)

## Placeholders

| Placeholder | Token | Expands to | Example for `a/folder/file.txt` |
| --- | --- | --- | --- |
| `{}` | `Placeholder` | the path | `a/folder/file.txt` |
| `{/}` | `Basename` | the last component | `file.txt` |
| `{//}` | `Parent` | the parent directory | `a/folder` |
| `{.}` | `NoExt` | the path without its extension | `a/folder/file` |
| `{/.}` | `BasenameNoExt` | the last component without its extension | `file` |
| `{{` | | a literal `{` | |
| `}}` | | a literal `}` | |

Sources: [src/fmt/mod.rs:13-39](repo://src/fmt/mod.rs#L13-L39), [src/fmt/mod.rs:236-280](repo://src/fmt/mod.rs#L236-L280)

The path a template receives is the displayed path, `DirEntry::stripped_path`, so in the default mode it has no leading `./` ([[Printing Results]]).

Sources: [src/output.rs:68-78](repo://src/output.rs#L68-L78), [src/exec/job.rs:33-39](repo://src/exec/job.rs#L33-L39)

## Parsing

### The token scan

`FormatTemplate::parse` finds the next placeholder or escape with an `AhoCorasick` automaton over the seven strings `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}`. The automaton is built once and kept in a `OnceLock`. Text between matches collects in a buffer, which is pushed as a `Token::Text` before each placeholder token.

Sources: [src/fmt/mod.rs:51-92](repo://src/fmt/mod.rs#L51-L92)

Each match is handled according to its pattern id:

Sources: [src/fmt/mod.rs:67-91](repo://src/fmt/mod.rs#L67-L91)

1. `{{` or `}}` (ids 0 and 1): the first brace goes into the text buffer and the second is skipped.
2. A placeholder not followed by `}`: the buffer is flushed as text and the placeholder's token, from `token_from_pattern_id`, is pushed.
3. A placeholder followed by `}`: the closing brace is read as an escaped `}}`, so the placeholder text stays literal and the extra `}` is dropped; `{.}}` gives the text `{.}`.

Sources: [src/fmt/mod.rs:67-91](repo://src/fmt/mod.rs#L67-L91), [src/fmt/mod.rs:199-211](repo://src/fmt/mod.rs#L199-L211), [src/exec/mod.rs:368-383](repo://src/exec/mod.rs#L368-L383)

### Text or tokens

When the scan finds no placeholder, `parse` returns `FormatTemplate::Text` with the escapes already resolved; otherwise it returns `FormatTemplate::Tokens`, ending with any trailing text. `has_tokens` tells the two apart, and the command code relies on it to know which arguments contain a placeholder ([[Command Execution]]).

Sources: [src/fmt/mod.rs:93-107](repo://src/fmt/mod.rs#L93-L107), [src/fmt/mod.rs:54-56](repo://src/fmt/mod.rs#L54-L56), [src/fmt/mod.rs:218-234](repo://src/fmt/mod.rs#L218-L234)

```rust
let templ = FormatTemplate::parse("This string only has escapes like {{ and }}");
assert_eq!(
    templ,
    FormatTemplate::Text("This string only has escapes like { and }".into())
);
```

Sources: [src/fmt/mod.rs:227-234](repo://src/fmt/mod.rs#L227-L234)

## Expansion

`generate` takes a path and an optional path separator and returns an `OsString`, so paths that are not valid UTF-8 survive expansion. For `Tokens` it appends each token's value in order; `Text` tokens and the whole of a `Text` template are copied as written. The separator is replaced only in the values of placeholders, never in fixed text.

Sources: [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141)

The path helpers live in `fmt/input.rs`:

Sources: [src/fmt/input.rs:1-32](repo://src/fmt/input.rs#L1-L32)

| Helper | Behavior | Examples |
| --- | --- | --- |
| `basename` | `file_name()`, or the whole path when there is none | `dir/foo.txt` → `foo.txt` |
| `dirname` | `parent()`; an empty parent becomes `.`, and a path with no parent is returned as it is | `foo.txt` → `.`, `/` → `/` |
| `remove_extension` | joins `dirname` and `file_stem()`, then strips a leading `./` | `dir/foo.txt` → `dir/foo`, `.foo` → `.foo` |

Sources: [src/fmt/input.rs:5-32](repo://src/fmt/input.rs#L5-L32), [src/fmt/input.rs:56-86](repo://src/fmt/input.rs#L56-L86)

## Custom path separators

With `--path-separator`, `replace_separator` rebuilds each placeholder value from its `Path::components()`. The root directory becomes the separator, and normal components are joined with it; without a custom separator the value is borrowed unchanged.

Sources: [src/fmt/mod.rs:143-196](repo://src/fmt/mod.rs#L143-L196)

Windows prefixes need extra care. A UNC prefix `\\server\share` is written as two separators, the server, a separator and the share. Other prefixes, such as a drive letter `C:`, are copied as they are, and verbatim `\\?\` prefixes are deliberately not converted; the code comment notes they are rare and that users who need them can post-process the output. The tests show the results: `C:\foo\bar` becomes `C:#foo#bar` and `\\server\share\path` becomes `##server#share#path` with `#` as the separator.

Sources: [src/fmt/mod.rs:157-182](repo://src/fmt/mod.rs#L157-L182), [src/exec/mod.rs:445-485](repo://src/exec/mod.rs#L445-L485)
