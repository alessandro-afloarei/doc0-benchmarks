---
title: "Quickstart"
---
## Overview

This page builds fd, runs a first search, and lists the options that change what is searched and printed. It does not explain how a search runs: that is in [[fd Overview]] and the pages it links.

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112)

## Build it

fd is built with Cargo. The Makefile's release target runs `cargo build` with the release profile and `--locked`, so the build uses the versions in `Cargo.lock`.

Sources: [Makefile:1-9](repo://Makefile#L1-L9)

```bash
cargo build --profile release --locked
```

Sources: [Makefile:8-9](repo://Makefile#L8-L9)

The README gives the same build for development, plus `cargo test` for the test suite and `cargo install --path .` to install the binary.

Sources: [README.md:738-746](repo://README.md#L738-L746)

## First search

With one argument, fd treats it as a regular expression and searches the current directory recursively for names that match it. A pattern matches any part of a name unless it is anchored with `^` or `$`.

Sources: [README.md:40-63](repo://README.md#L40-L63)

```bash
fd netfl
fd '^x.*rc$' /etc
```

Sources: [README.md:40-63](repo://README.md#L40-L63)

The search is case-insensitive unless the pattern contains an uppercase letter (smart case), or unless `--case-sensitive` is given. The rule that decides this is in [[Startup and Configuration]].

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255)

## Options that change the search

| Option | Effect | Explained in |
| --- | --- | --- |
| `-H`, `--hidden` | Include hidden files and directories | [[Walker and Ignore Rules]] |
| `-s`, `--case-sensitive` | Match case exactly | [[Startup and Configuration]] |
| `-i`, `--ignore-case` | Ignore case, even for an uppercase pattern | [[Startup and Configuration]] |
| `-g`, `--glob` | Read the pattern as a glob, not a regular expression | [[Startup and Configuration]] |
| `-t`, `--type` | Keep only files, directories, symlinks or other types | [[Entry Filters]] |
| `-x`, `--exec` | Run a command for each result | [[Running Commands with --exec]] |

Sources: [src/cli.rs:38-44](repo://src/cli.rs#L38-L44), [src/cli.rs:131-160](repo://src/cli.rs#L131-L160), [src/cli.rs:368-369](repo://src/cli.rs#L368-L369), [README.md:154-154](repo://README.md#L154-L154)

## Options that change the output

`--format` replaces the printed line with a template in which `{}`, `{/}`, `{//}`, `{.}` and `{/.}` stand for parts of each path. The placeholder rules are the same ones `--exec` uses, and they are described in [[Format Templates]].

Sources: [src/fmt/mod.rs:13-39](repo://src/fmt/mod.rs#L13-L39)

Output to a terminal is sanitized, and output to a pipe is not. The reasons and the escape rules are in [[Printing Results]].

Sources: [src/output.rs:17-43](repo://src/output.rs#L17-L43), [src/sanitize.rs:49-55](repo://src/sanitize.rs#L49-L55)

## Where to go next

- [[Startup and Configuration]] shows how each option becomes a field of `Config`.
- [[Walker and Ignore Rules]] explains which files are skipped before any pattern is checked.
- [[Result Receiver and Ordering]] explains why small searches print sorted and large ones print as they are found.

Sources: [src/main.rs:248-263](repo://src/main.rs#L248-L263), [src/walk.rs:198-225](repo://src/walk.rs#L198-L225)
