---
title: "Quickstart"
---
## Overview

This page builds `fd` from this repository, installs it with its shell completions, and runs a few first searches. It needs Rust 1.90.0 or later: the crate sets `rust-version = "1.90.0"` and the 2024 edition.

Sources: [Cargo.toml:16-21](repo://Cargo.toml#L16-L21), [README.md:720-728](repo://README.md#L720-L728)

## Build and test

Build with cargo, run the unit and integration tests (the harness behind them is on [[Testing and Release]]), and install the binary from the checkout:

Sources: [README.md:734-747](repo://README.md#L734-L747)

```bash
git clone https://github.com/sharkdp/fd

# Build
cd fd
cargo build

# Run unit tests and integration tests
cargo test

# Install
cargo install --path .
```

Sources: [README.md:734-747](repo://README.md#L734-L747)

The release profile enables link-time optimisation, strips the binary and uses one codegen unit; the dev profile keeps only line tables for debug info, and a `debugging` profile restores full debug info. On Windows MSVC targets, `.cargo/config.toml` links the C runtime statically so the executable does not depend on the vcruntime DLL.

Sources: [Cargo.toml:79-92](repo://Cargo.toml#L79-L92), [.cargo/config.toml:1-9](repo://.cargo/config.toml#L1-L9)

## Cargo features

| Feature | Enables | Default |
| --- | --- | --- |
| `completions` | `clap_complete` and the hidden `--gen-completions` flag | yes |
| `use-jemalloc` | the `tikv-jemallocator` global allocator on supported targets | no |
| `base` | `use-jemalloc` | no |

Sources: [Cargo.toml:94-98](repo://Cargo.toml#L94-L98), [src/main.rs:42-54](repo://src/main.rs#L42-L54)

With `completions` on, `run` checks `--gen-completions` before anything else. Without a value it detects the shell from the environment; `print_completions` names the completion after the program's file stem (falling back to `fd`), so a binary installed as `fdfind` gets `fdfind` completions.

Sources: [src/main.rs:75-81](repo://src/main.rs#L75-L81), [src/main.rs:114-129](repo://src/main.rs#L114-L129), [src/cli.rs:775-785](repo://src/cli.rs#L775-L785)

## Install with make

`make install` builds the release binary with `cargo build --profile release --locked`, generates bash, fish and PowerShell completions by running `fd --gen-completions`, copies the hand-written zsh and `fdfind` completions from `contrib/completion`, and installs the binary, the completions and the `doc/fd.1` man page under `prefix` (default `/usr/local`).

Sources: [Makefile:1-52](repo://Makefile#L1-L52)

```bash
make install prefix=$HOME/.local
```

Sources: [Makefile:1-52](repo://Makefile#L1-L52)

## First searches

Run `fd` with a pattern to search the current directory recursively for entries whose name contains a match; a second argument names the directory to search. With no arguments, `fd` lists everything below the current directory.

Sources: [README.md:40-94](repo://README.md#L40-L94)

```bash
fd netfl
fd '^x.*rc$' /etc
fd
```

Sources: [README.md:40-94](repo://README.md#L40-L94)

Filter by extension with `-e`, match a whole file name with a glob using `-g`, and include hidden or ignored entries with `-H` and `-I` (or `-u` for both):

Sources: [README.md:96-143](repo://README.md#L96-L143)

```bash
fd -e md
fd -g libc.so /usr
fd -H pre-commit
fd -I num_cpu
```

Sources: [README.md:96-143](repo://README.md#L96-L143)

Run a command for every result with `-x`, or once with all results with `-X`:

Sources: [README.md:154-175](repo://README.md#L154-L175), [src/cli.rs:932-949](repo://src/cli.rs#L932-L949)

```bash
fd -e zip -x unzip
fd -e rs -X wc -l
```

Sources: [README.md:154-175](repo://README.md#L154-L175), [src/cli.rs:932-949](repo://src/cli.rs#L932-L949)

## Where to go next

Every flag and the `Config` field it sets are on [[Command-Line Options and Configuration]]; how the pattern is interpreted is on [[Pattern Matching]]; why a file does not show up is usually explained by [[Ignore Rules and Exclusions]].

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112)
