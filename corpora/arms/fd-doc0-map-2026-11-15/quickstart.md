---
title: "Quickstart"
---
## Overview

This page installs `fd` and runs the searches most people need: a pattern, a root directory, an extension or type filter, and hidden or ignored files. [[Overview]] explains how a search runs inside the program.

Sources: [README.md:34-50](repo://README.md#L34-L50)

## Install

The crate is published as `fd-find` and builds a binary named `fd`. It needs Rust 1.90.0 or later.

Sources: [Cargo.toml:16-31](repo://Cargo.toml#L16-L31), [README.md:720-728](repo://README.md#L720-L728)

```bash
cargo install fd-find
```

Sources: [README.md:722-725](repo://README.md#L722-L725)

To build from a clone, run the tests and install the local build.

Sources: [README.md:734-747](repo://README.md#L734-L747)

```bash
cargo build
cargo test
cargo install --path .
```

Sources: [README.md:734-747](repo://README.md#L734-L747)

`make install` builds the release binary with `cargo build --profile release --locked`, generates the bash, fish and PowerShell completions with `fd --gen-completions`, and installs the binary, completions and the `doc/fd.1` man page under `prefix` (`/usr/local` by default).

Sources: [Makefile:1-52](repo://Makefile#L1-L52)

> [!NOTE]
> The Debian and Ubuntu package names the binary `fdfind`, because another package already uses `fd`. Link it with `ln -s $(which fdfind) ~/.local/bin/fd` to use the commands on this page as written.

Sources: [README.md:542-553](repo://README.md#L542-L553)

## First searches

The positional arguments are an optional pattern and optional root directories. An empty pattern matches every entry, and without a path fd searches the current directory. A pattern that starts with `-` must follow `--`.

Sources: [src/cli.rs:626-659](repo://src/cli.rs#L626-L659)

```bash
fd netfl              # entries whose name contains "netfl"
fd '^x.*rc$' /etc     # a regex, searched under /etc
fd                    # list everything below the current directory
fd -- -foo            # a pattern that starts with a dash
```

Sources: [README.md:40-80](repo://README.md#L40-L80), [src/cli.rs:626-639](repo://src/cli.rs#L626-L639)

The pattern is matched against the file name only. A pattern containing `/` is refused with a hint to use `fd . 'dir'` or `--full-path`; `-p`/`--full-path` matches against the absolute path instead.

Sources: [src/main.rs:149-216](repo://src/main.rs#L149-L216)

## Pattern modes and case

| Flag | Effect |
| --- | --- |
| (none) | the pattern is a regular expression |
| `-g`, `--glob` | the pattern is a glob, such as `'*.rs'` |
| `-F`, `--fixed-strings` | the pattern is a literal string |
| `--exact` | the pattern must equal the whole name |
| `--and <pattern>` | an extra pattern every result must also match |
| `-s`, `--case-sensitive` | always case-sensitive |
| `-i`, `--ignore-case` | always case-insensitive |

Sources: [src/cli.rs:130-211](repo://src/cli.rs#L130-L211), [src/main.rs:218-232](repo://src/main.rs#L218-L232)

By default the search is smart case: case-insensitive unless a pattern contains an uppercase character.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255)

## Filters

| Flag | Keeps |
| --- | --- |
| `-e`, `--extension <ext>` | names ending in that extension (repeatable, case-insensitive) |
| `-t`, `--type <filetype>` | `f` file, `d` directory, `l` symlink, `x` executable, `e` empty, `s` socket, `p` pipe, `b` block device, `c` char device |
| `-d`, `--max-depth <depth>` | entries at most that deep |
| `-E`, `--exclude <glob>` | everything except entries matching the glob |
| `-S`, `--size <size>` | files of that size, such as `+10m` or `-500k` |
| `--changed-within <date or duration>` | entries modified more recently, such as `2weeks` |
| `-o`, `--owner <user:group>` | entries with that owner (Unix) |

Sources: [src/cli.rs:278-288](repo://src/cli.rs#L278-L288), [src/cli.rs:310-417](repo://src/cli.rs#L310-L417), [src/cli.rs:419-473](repo://src/cli.rs#L419-L473)

```bash
fd -e md              # Markdown files
fd -tf -e rs main     # regular .rs files whose name contains "main"
fd -te -td            # empty directories
fd -E node_modules js # skip node_modules
```

Sources: [src/cli.rs:333-393](repo://src/cli.rs#L333-L393)

## Hidden and ignored files

fd skips hidden entries and anything listed in `.gitignore`, `.ignore`, `.fdignore` or the global ignore file. `-H`/`--hidden` includes hidden entries, `-I`/`--no-ignore` stops reading ignore files, and `-u`/`--unrestricted` does both.

Sources: [src/cli.rs:36-60](repo://src/cli.rs#L36-L60), [src/cli.rs:124-128](repo://src/cli.rs#L124-L128), [src/main.rs:313-320](repo://src/main.rs#L313-L320)

```bash
fd -H .env            # include hidden files
fd -u target          # include hidden and ignored entries
```

Sources: [README.md:124-144](repo://README.md#L124-L144)
