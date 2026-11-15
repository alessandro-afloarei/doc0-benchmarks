---
title: "Placeholder Templates"
---
## Overview

`--format` and every argument of `--exec`/`--exec-batch` use the same small template language, implemented in `src/fmt`. A template is parsed once into a `FormatTemplate` and then expanded for each path. Keeping one parser means `fd --format '{/.}'` and `fd -x echo '{/.}'` produce the same text.

Sources: [src/fmt/mod.rs:41-58](repo://src/fmt/mod.rs#L41-L58), [src/main.rs:374-377](repo://src/main.rs#L374-L377), [src/exec/mod.rs:228-234](repo://src/exec/mod.rs#L228-L234)

## Placeholders

| Placeholder | Token | For `documents/images/party.jpg` |
| --- | --- | --- |
| `{}` | `Placeholder` | `documents/images/party.jpg` |
| `{/}` | `Basename` | `party.jpg` |
| `{//}` | `Parent` | `documents/images` |
| `{.}` | `NoExt` | `documents/images/party` |
| `{/.}` | `BasenameNoExt` | `party` |
| `{{` | literal | `{` |
| `}}` | literal | `}` |

Sources: [src/fmt/mod.rs:13-39](repo://src/fmt/mod.rs#L13-L39), [README.md:227-234](repo://README.md#L227-L234)

## Parsing

`FormatTemplate::parse` scans the string with an Aho-Corasick automaton built once (in a `OnceLock`) over the seven patterns `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}`, and handles each match by its kind.

Sources: [src/fmt/mod.rs:58-67](repo://src/fmt/mod.rs#L58-L67)

1. An escape, `{{` or `}}`, adds one brace to the text buffer.
2. A placeholder not followed by `}` flushes the buffered text as a `Token::Text` and adds the placeholder's token, chosen by `token_from_pattern_id`.
3. A placeholder followed by `}` is read as the placeholder's text with an escaped closing brace, so `{}}` is the literal text `{}`.

Sources: [src/fmt/mod.rs:51-92](repo://src/fmt/mod.rs#L51-L92), [src/fmt/mod.rs:199-211](repo://src/fmt/mod.rs#L199-L211)

If no placeholder was found, the result is `FormatTemplate::Text` with the escapes resolved; otherwise it is `FormatTemplate::Tokens`. `has_tokens` tells them apart, which is how [[Command Execution]] knows whether to append an implicit `{}` and which argument receives the paths in batch mode.

Sources: [src/fmt/mod.rs:53-56](repo://src/fmt/mod.rs#L53-L56), [src/fmt/mod.rs:93-107](repo://src/fmt/mod.rs#L93-L107), [src/exec/mod.rs:250-253](repo://src/exec/mod.rs#L250-L253)

## Expansion

`generate` builds an `OsString`, not a `String`, so a path that is not valid UTF-8 passes into a command argument unchanged. `Text` tokens are copied as they are. Each path token is computed by a helper from `src/fmt/input.rs`.

Sources: [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141)

| Helper | Behavior |
| --- | --- |
| `basename` | The file name, or the whole path when there is none |
| `dirname` | The parent; `.` for a bare file name; the path itself for a root such as `/` |
| `remove_extension` | Parent joined with the file stem, with a leading `./` removed; a dot file such as `.foo` keeps its name |

Sources: [src/fmt/input.rs:6-32](repo://src/fmt/input.rs#L6-L32), [src/fmt/input.rs:56-86](repo://src/fmt/input.rs#L56-L86)

## Custom path separators

When `--path-separator` is set, `replace_separator` rewrites the path produced by each placeholder; text around it is left alone. It walks the path's components and joins them with the custom separator. A root directory becomes the separator. On Windows a UNC prefix `\\server\share` is rewritten with the separator, while other prefixes such as `C:` are kept as they are. Without a custom separator it returns the input borrowed, at no cost.

Sources: [src/fmt/mod.rs:143-196](repo://src/fmt/mod.rs#L143-L196)
