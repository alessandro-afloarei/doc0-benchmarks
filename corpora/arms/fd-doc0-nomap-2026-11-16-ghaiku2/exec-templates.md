---
title: "Exec Templates"
---
## Overview

Each `--exec` or `--exec-batch` argument is parsed into a `FormatTemplate` while the command line is read, and the `--format` string is parsed in `construct_config`. A template is either fixed text or a list of `Token`s with at least one placeholder. Expanding a template for a path is then a single pass over its tokens, and the same expansion serves the command arguments and the printed format.

Sources: [src/cli.rs:861-880](repo://src/cli.rs#L861-L880), [src/main.rs:374-376](repo://src/main.rs#L374-L376), [src/fmt/mod.rs:13-49](repo://src/fmt/mod.rs#L13-L49), [src/exec/mod.rs:210-217](repo://src/exec/mod.rs#L210-L217)

## Placeholder tokens

The tokens are `{}` for the whole path, `{/}` for the base name, `{//}` for the parent directory, `{.}` for the path without its extension, and `{/.}` for the base name without its extension. Any other text is kept as a `Text` token. `Token::Display` writes each token back in the same form, so a template can be shown in messages as the user wrote it.

Sources: [src/fmt/mod.rs:17-39](repo://src/fmt/mod.rs#L17-L39), [src/fmt/mod.rs:201-211](repo://src/fmt/mod.rs#L201-L211)

## Parsing

`parse` finds the placeholders with one Aho-Corasick automaton built over the seven patterns, and the automaton is built once and kept in a `OnceLock`. A doubled brace, `{{` or `}}`, is written as one brace and does not start a placeholder. A placeholder followed directly by another `}` is not expanded: `{}}` is kept as the literal text `{}`, and the extra brace is dropped.

Sources: [src/fmt/mod.rs:51-66](repo://src/fmt/mod.rs#L51-L66), [src/fmt/mod.rs:67-92](repo://src/fmt/mod.rs#L67-L92)

When no placeholder is found, `parse` returns `FormatTemplate::Text` with the unescaped string, so an argument such as `--format 'done'` is printed as given.

Sources: [src/fmt/mod.rs:97-100](repo://src/fmt/mod.rs#L97-L100)

## Expanding a template

`generate` walks the tokens in order and appends each one's value to an `OsString`. The value of a placeholder comes from the input path: `basename`, `dirname` and `remove_extension` each return the part they name, and `remove_extension` drops `./` from its result when the path had no directory. The path is taken as an `OsStr`, so a name that is not valid UTF-8 is passed through unchanged.

Sources: [src/fmt/mod.rs:112-140](repo://src/fmt/mod.rs#L112-L140), [src/fmt/input.rs:6-32](repo://src/fmt/input.rs#L6-L32)

When a path separator is given, `replace_separator` rebuilds each placeholder value from its components. The root is written as the custom separator and each joining separator is replaced, and a Windows UNC prefix is rebuilt with two separators in front. Text tokens are never changed, so a literal `/` in the template stays a `/`.

Sources: [src/fmt/mod.rs:143-196](repo://src/fmt/mod.rs#L143-L196)

## Command templates

`CommandTemplate::new` takes the argument list of one `--exec` or `--exec-batch` occurrence and parses each argument. The first argument is the program. If no argument holds a placeholder, `{}` is appended, so a command without one still receives the path as its last argument.

Sources: [src/exec/mod.rs:219-255](repo://src/exec/mod.rs#L219-L255)

Two cases are rejected. An empty command is an error, because without a program `fd` would try to execute every entry it finds. A placeholder as the program is rejected in batch mode, since a batch needs one fixed program that is started once for all paths.

Sources: [src/exec/mod.rs:241-248](repo://src/exec/mod.rs#L241-L248)

In batch mode, `new_batch` also requires at most one placeholder in the command. `number_of_tokens` counts the placeholders, and a command with more than one is rejected with "Only one placeholder allowed for batch commands". Since a missing placeholder was already replaced by `{}`, a batch command has exactly one.

Sources: [src/exec/mod.rs:51-68](repo://src/exec/mod.rs#L51-L68), [src/exec/mod.rs:258-260](repo://src/exec/mod.rs#L258-L260)

`CommandTemplate::generate` expands the program and every argument for one path, and the result is a ready `Command`. It is used for one-by-one execution, while batch mode collects expanded path arguments and builds commands from them; see [[Running Commands]].

Sources: [src/exec/mod.rs:266-272](repo://src/exec/mod.rs#L266-L272)
