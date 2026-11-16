---
title: "Placeholder Templates"
---
## Overview

fd has one small template language for turning a result path into text. `--format` uses it to print each result, `--exec` uses it to build each command argument, and `--exec-batch` uses it to build the argument that repeats for every result. All of it lives in `src/fmt`: `FormatTemplate::parse` turns a string into tokens once, and `FormatTemplate::generate` fills those tokens in for each path. [[Output Formatting]] shows where `--format` output is written, and [[Command Execution]] shows how command templates are assembled from these pieces.

Sources: [src/fmt/mod.rs:13-49](repo://src/fmt/mod.rs#L13-L49), [src/main.rs:374-377](repo://src/main.rs#L374-L377), [src/exec/mod.rs:219-256](repo://src/exec/mod.rs#L219-L256)

## Syntax

| Placeholder | Token | Expands to | For `dir/sub/file.txt` |
| --- | --- | --- | --- |
| `{}` | `Placeholder` | the path | `dir/sub/file.txt` |
| `{/}` | `Basename` | the last component | `file.txt` |
| `{//}` | `Parent` | the parent directory | `dir/sub` |
| `{.}` | `NoExt` | the path without its extension | `dir/sub/file` |
| `{/.}` | `BasenameNoExt` | the last component without its extension | `file` |
| `{{` | text | a literal `{` | |
| `}}` | text | a literal `}` | |

Sources: [src/fmt/mod.rs:13-39](repo://src/fmt/mod.rs#L13-L39), [src/fmt/mod.rs:236-280](repo://src/fmt/mod.rs#L236-L280)

Any other text is copied literally, including a lone `{` or `}` that does not form one of these sequences. A placeholder immediately followed by `}` is also kept literally: `{.}}` produces the text `{.}`. That is how a literal placeholder is written.

Sources: [src/fmt/mod.rs:58-107](repo://src/fmt/mod.rs#L58-L107), [src/exec/mod.rs:368-383](repo://src/exec/mod.rs#L368-L383)

```bash
fd -e jpg -x convert {} {.}.png        # photo.jpg -> photo.png
fd --format '{//}: {/}'                 # "dir/sub: file.txt"
fd -x echo '{{{},end}'                  # prints "{path,end}"
```

Sources: [src/cli.rs:900-917](repo://src/cli.rs#L900-L917), [src/exec/mod.rs:379-383](repo://src/exec/mod.rs#L379-L383)

## Parsing

### Matching with aho-corasick

`FormatTemplate::parse` builds, once per process in a `OnceLock`, an `AhoCorasick` automaton over the seven sequences `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}`. It then repeatedly finds the next match in the remaining input and handles it by pattern index:

Sources: [src/fmt/mod.rs:58-67](repo://src/fmt/mod.rs#L58-L67)

- Indexes 0 and 1 (`{{`, `}}`): the text before the match plus one brace is appended to a text buffer, and the second brace is skipped.
- A placeholder not followed by `}`: the buffered text is flushed as a `Token::Text`, then `token_from_pattern_id` adds the placeholder token.
- A placeholder followed by `}`: the placeholder is appended to the text buffer as literal text and the extra `}` is skipped.

Sources: [src/fmt/mod.rs:51-92](repo://src/fmt/mod.rs#L51-L92), [src/fmt/mod.rs:199-211](repo://src/fmt/mod.rs#L199-L211)

### Text or Tokens

After the loop, the rest of the input is added to the buffer. If no placeholder was found, the result is `FormatTemplate::Text` holding the unescaped string. Otherwise any remaining text becomes a final `Token::Text`, and the result is `FormatTemplate::Tokens`. `has_tokens` tells the two apart, and the command code relies on it to find which arguments depend on the path.

Sources: [src/fmt/mod.rs:93-107](repo://src/fmt/mod.rs#L93-L107), [src/fmt/mod.rs:53-56](repo://src/fmt/mod.rs#L53-L56)

## Generating

### Expanding a template

`generate(path, path_separator)` returns an `OsString`. A `Text` template returns its text unchanged. A `Tokens` template concatenates its tokens, computing each placeholder from the path with the helpers in `src/fmt/input.rs` and passing every placeholder value, but never the literal text, through `replace_separator`.

Sources: [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141)

### Path helpers

| Helper | Behaviour |
| --- | --- |
| `basename` | `Path::file_name`, or the whole path when there is none |
| `dirname` | `Path::parent`; an empty parent becomes `.`, and a root with no parent stays itself |
| `remove_extension` | the parent joined with `file_stem`, then a leading `./` is stripped |

Sources: [src/fmt/input.rs:6-32](repo://src/fmt/input.rs#L6-L32)

So `{//}` of `file.txt` is `.`, `{.}` of `file.txt` is `file` rather than `./file`, and a hidden file such as `.foo` keeps its whole name because `file_stem` treats the leading dot as part of the name. Paths are handled as `OsStr`, so placeholders work on names that are not valid UTF-8.

Sources: [src/fmt/input.rs:56-73](repo://src/fmt/input.rs#L56-L73)

### Custom path separators

When `--path-separator` is set, `replace_separator` rebuilds each placeholder value from its `Path::components`. Normal components are joined with the custom separator, and a root directory becomes the separator, so `/foo/bar` with `#` becomes `#foo#bar`. Windows prefixes are handled separately: a UNC prefix `\\server\share` becomes two separators, the server, a separator and the share; drive letters such as `C:` are copied as they are. Without a custom separator the value is borrowed unchanged, which keeps the common case cheap.

Sources: [src/fmt/mod.rs:143-196](repo://src/fmt/mod.rs#L143-L196), [src/exec/mod.rs:445-485](repo://src/exec/mod.rs#L445-L485)

## Where templates are used

`--format` is parsed once in `construct_config` and stored as `Config::format`, then expanded per result with the stripped display path. For `--exec` and `--exec-batch`, `CommandTemplate::new` parses each command-line word as its own `FormatTemplate`, and appends a `{}` token when no word contains a placeholder. The command name itself may be a placeholder for `--exec` but not for `--exec-batch`, which also allows only one templated word. [[Command Execution]] explains those rules.

Sources: [src/output.rs:68-86](repo://src/output.rs#L68-L86), [src/exec/mod.rs:219-261](repo://src/exec/mod.rs#L219-L261), [src/exec/mod.rs:51-70](repo://src/exec/mod.rs#L51-L70)
