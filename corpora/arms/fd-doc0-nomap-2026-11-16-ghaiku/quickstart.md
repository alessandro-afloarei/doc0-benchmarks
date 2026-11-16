---
title: "Quickstart"
---
## Overview

A plain `fd` run takes one positional pattern and, optionally, one or more root directories. Without a root, the search starts in the current directory. The other options either narrow the walk or choose what happens to each result; the code turns them into fields of `Config`.

Sources: [src/cli.rs:631-646](repo://src/cli.rs#L631-L646), [src/cli.rs:696-721](repo://src/cli.rs#L696-L721)

## Pattern and roots

The pattern is a regular expression matched against each file name, unless `--glob`, `--fixed-strings` or `--exact` change how it is read. An empty pattern matches every entry. The roots are the `path` arguments; each must be an existing directory, and any that is not is reported and skipped. When every root is missing, the run stops with `No valid search paths given.`

Sources: [src/main.rs:94-101](repo://src/main.rs#L94-L101), [src/cli.rs:696-721](repo://src/cli.rs#L696-L721), [src/main.rs:84-87](repo://src/main.rs#L84-L87)

```sh
fd 'README' src/
fd --glob '*.rs' .
fd --fixed-strings 'a.b'
```

Sources: [src/cli.rs:156-185](repo://src/cli.rs#L156-L185), [src/main.rs:218-232](repo://src/main.rs#L218-L232)

## Hidden and ignored files

Hidden entries and entries excluded by `.gitignore`, `.fdignore` or the global ignore file are skipped by default. `-H` (`--hidden`) includes hidden entries, and `-I` (`--no-ignore`) turns off ignore-file handling. `-u` combines both. The mapping from these flags to the walker is in `construct_config`, where `ignore_hidden` is the negation of `--hidden`.

Sources: [src/cli.rs:39-62](repo://src/cli.rs#L39-L62), [src/cli.rs:124-126](repo://src/cli.rs#L124-L126), [src/main.rs:313-318](repo://src/main.rs#L313-L318)

## Narrowing the result

`-e` (`--extension`) keeps names ending in the given extension, compared case-insensitively. `-t` (`--type`) keeps one or more kinds of entry, such as `f`, `d`, `l` or `x` for executables. `-S` filters by size and `--changed-within` filters by modification time. Each becomes a field on `Config` that the sender thread checks after the name matches; [[Entry Filters]] explains the checks.

Sources: [src/cli.rs:367-393](repo://src/cli.rs#L367-L393), [src/cli.rs:412-440](repo://src/cli.rs#L412-L440), [src/main.rs:333-378](repo://src/main.rs#L333-L378)

## Running a command or a template

`-x` (`--exec`) runs a command once per result, with its arguments up to a terminating `;`. `-X` (`--exec-batch`) collects results and runs the command with them as arguments. `--format` prints each result through a template instead of its path. `-x`, `-X` and `-l` are mutually exclusive, and `--format` cannot be combined with `-l`.

Sources: [src/cli.rs:480-487](repo://src/cli.rs#L480-L487), [src/cli.rs:856-900](repo://src/cli.rs#L856-L900), [src/main.rs:395-405](repo://src/main.rs#L395-L405)

```sh
fd -e md --exec wc -l {}
fd -t f -X ls -lh
fd --format '{/.}: {//}' '\.rs$'
```

Sources: [src/cli.rs:387-394](repo://src/cli.rs#L387-L394), [src/cli.rs:856-900](repo://src/cli.rs#L856-L900)
