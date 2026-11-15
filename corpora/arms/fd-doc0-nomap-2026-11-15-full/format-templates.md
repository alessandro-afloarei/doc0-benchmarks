---
title: "Format Templates and Placeholders"
---
## Overview

The `fmt` module parses the small template language shared by `--format` and by every argument of `--exec` and `--exec-batch`. A template is text with placeholders that are replaced by parts of a result's path. Parsing happens once at startup; generating a string for each result is then a walk over a token list, with no string searching.

Sources: [src/fmt/mod.rs:13-56](repo://src/fmt/mod.rs#L13-L56), [src/main.rs:374-377](repo://src/main.rs#L374-L377), [src/exec/mod.rs:219-234](repo://src/exec/mod.rs#L219-L234)

## Placeholders

| Placeholder | Token | Result for `documents/images/party.jpg` |
| --- | --- | --- |
| `{}` | `Placeholder` | `documents/images/party.jpg` |
| `{/}` | `Basename` | `party.jpg` |
| `{//}` | `Parent` | `documents/images` |
| `{.}` | `NoExt` | `documents/images/party` |
| `{/.}` | `BasenameNoExt` | `party` |
| `{{` | (escape) | a literal `{` |
| `}}` | (escape) | a literal `}` |

Sources: [src/fmt/mod.rs:17-39](repo://src/fmt/mod.rs#L17-L39), [README.md:227-236](repo://README.md#L227-L236)

```bash
fd -e jpg -x convert {} {.}.png
fd --format '{//}: {/}'
fd -tf --format 'mv {} {.}.bak'
```

Sources: [README.md:205-210](repo://README.md#L205-L210), [src/cli.rs:475-487](repo://src/cli.rs#L475-L487)

Some shells give braces a meaning of their own, so quoting the placeholders may be needed for fd to see them.

Sources: [README.md:447-450](repo://README.md#L447-L450)

## Parsing

### FormatTemplate

`FormatTemplate::parse` returns `Text` when the string holds no placeholder (after resolving escapes), and `Tokens` otherwise: a list of `Token::Text` segments and placeholder tokens. The distinction matters to `--exec`: `has_tokens` tells which arguments vary per result, which decides whether `{}` must be appended and which argument a batch command repeats.

Sources: [src/fmt/mod.rs:41-56](repo://src/fmt/mod.rs#L41-L56), [src/exec/mod.rs:245-253](repo://src/exec/mod.rs#L245-L253), [src/exec/mod.rs:135-149](repo://src/exec/mod.rs#L135-L149)

### The scanning loop

The parser finds all seven patterns (`{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}`, `{/.}`) in one pass with an Aho-Corasick automaton, built once into a `OnceLock`. Each match is handled in one of three ways.

Sources: [src/fmt/mod.rs:51-68](repo://src/fmt/mod.rs#L51-L68)

1. An escape (`{{` or `}}`) adds one brace to the text buffer and skips the other.
2. A placeholder not followed by `}` flushes the buffered text as a `Token::Text`, then pushes the placeholder token.
3. A placeholder followed by `}` is taken as literal text: the placeholder goes into the buffer and the extra `}` is dropped, so `{.}}` produces the text `{.}`.

Sources: [src/fmt/mod.rs:58-107](repo://src/fmt/mod.rs#L58-L107), [src/fmt/mod.rs:199-211](repo://src/fmt/mod.rs#L199-L211)

```rust
let placeholders = PLACEHOLDERS.get_or_init(|| {
    AhoCorasick::new(["{{", "}}", "{}", "{/}", "{//}", "{.}", "{/.}"]).unwrap()
});
```

Sources: [src/fmt/mod.rs:64-66](repo://src/fmt/mod.rs#L64-L66)

The module tests pin the behavior down: `{{}}` yields the text `{}`, and `{{{},end}` with the path `foo` yields `{foo,end}`.

Sources: [src/exec/mod.rs:368-383](repo://src/exec/mod.rs#L368-L383), [src/fmt/mod.rs:227-234](repo://src/fmt/mod.rs#L227-L234)

## Generating

`generate` builds an `OsString` (so paths that are not valid UTF-8 survive into command arguments) by appending each token's value. The path helpers in `fmt/input.rs` compute the values.

Sources: [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141)

- `basename` returns the file name, or the whole path when it has none.
- `dirname` returns the parent, `.` when the parent is empty, and the path itself for a root such as `/`.
- `remove_extension` joins the parent and the file stem and strips a leading `./`, so `foo.txt` becomes `foo` and a hidden name such as `.foo` keeps its dot.

Sources: [src/fmt/input.rs:1-32](repo://src/fmt/input.rs#L1-L32), [src/fmt/input.rs:56-86](repo://src/fmt/input.rs#L56-L86)

## Custom path separators

When `--path-separator` is set, `replace_separator` rewrites the output of every placeholder (never fixed text) by re-joining the path's components with the custom separator. The root directory becomes the separator, a Windows UNC prefix `\\server\share` becomes two separators followed by server, separator and share, and other prefixes such as `C:` are kept as they are. Verbatim `\\?\` prefixes are not converted. Without a custom separator the value is borrowed unchanged.

Sources: [src/fmt/mod.rs:143-197](repo://src/fmt/mod.rs#L143-L197)

## Where templates are used

`--format` renders the template in place of the path and is printed through the sanitizer like any other output (see [[Output and Colors]]); it conflicts with `--list-details`. For `--exec` and `--exec-batch`, each argument is its own template, and [[Command Execution]] describes how the arguments become processes.

Sources: [src/output.rs:68-86](repo://src/output.rs#L68-L86), [src/cli.rs:475-487](repo://src/cli.rs#L475-L487), [src/exec/mod.rs:262-272](repo://src/exec/mod.rs#L262-L272)
