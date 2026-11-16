---
title: "Format Templates"
---
## Overview

A template is a string with placeholders such as `{}` and `{/.}`. The same type, `FormatTemplate`, serves two users: `--format` renders one template per result as text, and `--exec` and `--exec-batch` turn each argument of the command into a template and generate it for each path. Parsing happens once; generating happens per entry, and only the placeholders depend on the path. [[Terminal Output]] describes where the text goes, and [[Running Commands]] describes how exec arguments are used.

Sources: [src/fmt/mod.rs:46-56](repo://src/fmt/mod.rs#L46-L56), [src/exec/mod.rs:215-256](repo://src/exec/mod.rs#L215-L256)

## Placeholders

The five placeholders map to tokens as follows: `{}` is the whole path, `{/}` the basename, `{//}` the parent directory, `{.}` the path without its extension, and `{/.}` the basename without its extension. Anything else in the template is text.

Sources: [src/fmt/mod.rs:18-25](repo://src/fmt/mod.rs#L18-L25), [src/fmt/mod.rs:201-212](repo://src/fmt/mod.rs#L201-L212)

The parser runs one Aho-Corasick search over the template for the seven patterns: the two escapes `{{` and `}}`, and the five placeholders. Matches are scanned left to right, and the text between them is collected into `Text` tokens. A placeholder followed directly by `}` is not expanded: the parser keeps `{}` as text and drops the extra `}`, so `{}}` produces the literal `{}`.

Sources: [src/fmt/mod.rs:58-109](repo://src/fmt/mod.rs#L58-L109)

A template with no placeholder at all is stored as plain `Text`. That case matters for `--format`, where it is printed unchanged for every result.

Sources: [src/fmt/mod.rs:96-101](repo://src/fmt/mod.rs#L96-L101), [src/fmt/mod.rs:112-119](repo://src/fmt/mod.rs#L112-L119)

## Generating a string

`generate` walks the tokens and appends each one to an `OsString`. Text is appended as is. Each placeholder is computed from the path by the helpers in `fmt/input.rs`: `basename` takes the file name, `dirname` takes the parent (returning `.` for a bare name), and `remove_extension` joins the parent and the file stem and strips a leading `./`.

Sources: [src/fmt/mod.rs:112-145](repo://src/fmt/mod.rs#L112-L145), [src/fmt/input.rs:7-35](repo://src/fmt/input.rs#L7-L35)

When a path separator is configured, `replace_separator` rewrites only placeholder output: it splits the path into components and rejoins them with the chosen separator. A Windows UNC prefix keeps its two leading separators. Text in the template is never rewritten, so a literal `/` in a template stays as it is.

Sources: [src/fmt/mod.rs:147-199](repo://src/fmt/mod.rs#L147-L199)

## Use in exec commands

`CommandTemplate::new` parses each argument separately, so a placeholder can appear inside an argument such as `--output={}.bak`. It records whether any argument had a placeholder. If none did, it appends a bare `{}` as the last argument, which is why `fd -x wc -l` receives each path without further syntax. An empty command is an error.

Sources: [src/exec/mod.rs:219-240](repo://src/exec/mod.rs#L219-L240)

The first argument is the program name and is generated like any other argument, so `--exec` may use a placeholder there. `--exec-batch` forbids that: its first argument must be a fixed program, and only one argument may contain placeholders.

Sources: [src/exec/mod.rs:241-256](repo://src/exec/mod.rs#L241-L256), [src/exec/mod.rs:51-70](repo://src/exec/mod.rs#L51-L70)

`CommandTemplate::generate` turns the templates into a `Command` for one path: the first template gives the program and each remaining one gives an argument, each generated with the same path and separator.

Sources: [src/exec/mod.rs:266-276](repo://src/exec/mod.rs#L266-L276)
