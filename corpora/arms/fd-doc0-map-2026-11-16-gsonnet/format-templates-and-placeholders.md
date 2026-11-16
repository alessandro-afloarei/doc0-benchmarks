---
title: "Format Templates and Placeholders"
---
## Overview

`src/fmt` holds the small template language that `--format` and `--exec`/`--exec-batch` share. A template string is parsed once, when the command line is turned into a `Config` (see [[Pattern and Config Setup]]), into a `FormatTemplate`; for every matched path, `generate` expands it into an `OsString`. `--format` feeds the result to the printer in [[Output Formatting and Terminal Safety]], and each argument of an exec command is a template too, as covered in [[Command Execution]].

Sources: [src/fmt/mod.rs:41-49](repo://src/fmt/mod.rs#L41-L49), [src/main.rs:374-378](repo://src/main.rs#L374-L378), [src/exec/mod.rs:219-256](repo://src/exec/mod.rs#L219-L256)

## Placeholders

A `Token` is either literal text or one of five placeholders. For the path `dir/foo.txt`:

| Placeholder | Token | Expands to | Example |
| --- | --- | --- | --- |
| `{}` | `Placeholder` | the path | `dir/foo.txt` |
| `{/}` | `Basename` | the file name | `foo.txt` |
| `{//}` | `Parent` | the parent directory | `dir` |
| `{.}` | `NoExt` | the path without its extension | `dir/foo` |
| `{/.}` | `BasenameNoExt` | the file name without its extension | `foo` |
| `{{` and `}}` | none | a literal `{` or `}` | `{` |

Sources: [src/fmt/mod.rs:13-39](repo://src/fmt/mod.rs#L13-L39), [src/fmt/mod.rs:112-141](repo://src/fmt/mod.rs#L112-L141), [src/fmt/input.rs:6-32](repo://src/fmt/input.rs#L6-L32)

The three path helpers in `input.rs` have edge cases worth knowing:

- `basename` falls back to the whole path when there is no file name.
- `dirname` returns `.` for a bare file name, and the path itself for a root.
- `remove_extension` joins the parent and the file stem and then strips a leading `./`. A hidden file such as `.foo` has no extension to remove.

Sources: [src/fmt/input.rs:6-32](repo://src/fmt/input.rs#L6-L32), [src/fmt/input.rs:56-73](repo://src/fmt/input.rs#L56-L73)

## Parsing

`FormatTemplate` has two variants: `Text` for a string with no placeholders and `Tokens` for one with at least one. `has_tokens` tells the exec code which arguments depend on the match.

Sources: [src/fmt/mod.rs:41-56](repo://src/fmt/mod.rs#L41-L56)

`parse` scans the string with a single Aho-Corasick automaton, built once into a `OnceLock`, over the seven patterns `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}`, `{/.}`. Each match is handled by its pattern id:

1. Ids 0 and 1 (`{{`, `}}`) are escapes: the text up to and including one brace goes to a buffer and the second brace is skipped.
2. For a placeholder id, if the next character is not `}`, the buffered text is flushed as a `Text` token and the placeholder token is pushed.
3. If the next character is `}`, the placeholder's closing brace was escaped, so the matched text is kept literally and the extra `}` is dropped.

When the scan ends, the rest of the string is added as text. If no token was produced the result is `Text`, otherwise `Tokens`.

Sources: [src/fmt/mod.rs:51-107](repo://src/fmt/mod.rs#L51-L107), [src/fmt/mod.rs:199-211](repo://src/fmt/mod.rs#L199-L211)

The tests in `exec/mod.rs` pin down the escapes: `{{}}` becomes `{}`, a lone `{{` becomes `{`, `{.}}` becomes the literal `{.}`, and `{{{},end}` with input `foo` becomes `{foo,end}`.

Sources: [src/exec/mod.rs:368-383](repo://src/exec/mod.rs#L368-L383)

## Generating a string

`generate` walks the tokens and appends to an `OsString`, so paths that are not valid UTF-8 survive expansion. Text tokens are copied as they are, and each placeholder token is computed from the path and then passed through `replace_separator`.

Sources: [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141)

If `--path-separator` is set, `replace_separator` rebuilds the placeholder output component by component with the custom separator. Fixed text in the template is never changed. Without a custom separator the input is returned borrowed, with no copy. The component walk handles Windows specially:

- a UNC prefix becomes two separators, the server, a separator and the share;
- other prefixes, such as a drive letter, are kept as they are;
- the root directory always becomes the custom separator;
- other components are joined, with a separator between them.

Sources: [src/fmt/mod.rs:143-196](repo://src/fmt/mod.rs#L143-L196)

```rust
check!("foo", "foo");
check!("foo/bar", "foo#bar");
check!("/foo/bar/baz", "#foo#bar#baz");
```

Sources: [src/exec/mod.rs:445-457](repo://src/exec/mod.rs#L445-L457)

With separator `#`, these are the results for `{}`: the root becomes the separator and nested components are joined with it.

Sources: [src/exec/mod.rs:445-457](repo://src/exec/mod.rs#L445-L457)

## Where the path comes from

Both consumers pass `DirEntry::stripped_path`, so with the usual defaults the placeholder `{}` for a file found in the current directory is `foo.txt` rather than `./foo.txt`, and `{//}` is `.`. A path that would start with a dash keeps its `./` so it cannot be read as an option.

Sources: [src/output.rs:75-78](repo://src/output.rs#L75-L78), [src/exec/job.rs:33-39](repo://src/exec/job.rs#L33-L39), [src/dir_entry.rs:56-71](repo://src/dir_entry.rs#L56-L71)
