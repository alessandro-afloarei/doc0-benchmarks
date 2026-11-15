---
title: "Quickstart"
---
## Overview

This page gets `fd` built from a checkout, running its first searches, and installed with shell completions and the man page. It needs a Rust toolchain at version 1.90.0 or later: the crate uses the 2024 edition and declares that minimum in `Cargo.toml`. What each flag means is left to [[Command-Line Options and Configuration]]; how the tests are organised is left to [[Testing and Releases]].

Sources: [Cargo.toml:18-21](repo://Cargo.toml#L18-L21), [README.md:720-728](repo://README.md#L720-L728)

## Build and test

1. Clone the repository and enter it.
2. Build with `cargo build`. The binary appears at `target/debug/fd`.
3. Run the unit and integration tests with `cargo test`.
4. Install into Cargo's bin directory with `cargo install --path .`.

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

The `dev` profile keeps only line tables for fd's own code and no debug info for dependencies, which keeps debug builds small; the `debugging` profile turns full debug info back on. The `release` profile enables LTO, a single codegen unit and symbol stripping, so release builds are slow to compile but produce a small, fast binary. On Windows MSVC targets, `.cargo/config.toml` links the C runtime statically so `fd.exe` does not need the vcruntime DLL.

Sources: [Cargo.toml:78-92](repo://Cargo.toml#L78-L92), [.cargo/config.toml:1-9](repo://.cargo/config.toml#L1-L9)

## First searches

Run `fd` with a pattern to search the current directory recursively; add a directory as a second argument to search there instead. With no arguments it lists everything below the current directory, much like `ls -R`.

Sources: [README.md:40-94](repo://README.md#L40-L94)

```bash
fd netfl            # names containing "netfl"
fd '^x.*rc$' /etc   # regular expression, searched in /etc
fd -e md            # all Markdown files
fd -H pre-commit    # include hidden files
fd -e zip -x unzip  # run a command on each result
```

Sources: [README.md:40-130](repo://README.md#L40-L130)

The pattern is a regular expression unless `--glob` is given, matching is case-insensitive until the pattern contains an uppercase letter, and hidden and git-ignored entries are skipped. [[Pattern Matching]] explains the pattern rules, and [[Command Execution]] covers `-x` and `-X`.

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232), [src/main.rs:248-256](repo://src/main.rs#L248-L256)

## Cargo features

| Feature | Default | What it does |
| --- | --- | --- |
| `completions` | yes | Pulls in `clap_complete` and enables the hidden `--gen-completions` flag |
| `use-jemalloc` | no | Uses `tikv-jemallocator` as the global allocator on the platforms where it is supported |
| `base` | no | Alias that turns on `use-jemalloc` |

Sources: [Cargo.toml:94-98](repo://Cargo.toml#L94-L98), [src/main.rs:38-54](repo://src/main.rs#L38-L54)

When `completions` is on, `run` checks `--gen-completions` before anything else and prints a script for the requested shell, or for the shell detected from the environment. The script names the program after the file stem of `argv[0]`, so a binary installed as `fdfind` gets completions for `fdfind`.

Sources: [src/main.rs:75-81](repo://src/main.rs#L75-L81), [src/main.rs:114-129](repo://src/main.rs#L114-L129), [src/cli.rs:775-785](repo://src/cli.rs#L775-L785)

## Install with make

The `Makefile` builds the release binary with `cargo build --profile release --locked`, then the `completions` target generates bash, fish and PowerShell completions by running the new binary with `--gen-completions`. The zsh scripts and the `fdfind` variants are copied from `contrib/completion`.

Sources: [Makefile:1-43](repo://Makefile#L1-L43)

`make install` copies the binary to `$(prefix)/bin` (default `/usr/local/bin`), the completions under `$(prefix)/share`, and the man page `doc/fd.1` to `share/man/man1`. Set `DESTDIR` to stage the files for a package, and `prefix` to change the root.

Sources: [Makefile:3-6](repo://Makefile#L3-L6), [Makefile:45-52](repo://Makefile#L45-L52)

```bash
make install prefix=$HOME/.local
```

Sources: [Makefile:45-52](repo://Makefile#L45-L52)

To install completions by hand, generate them from an installed binary:

Sources: [README.md:762-764](repo://README.md#L762-L764)

```bash
fd --gen-completions bash > ~/.local/share/bash-completion/completions/fd
fd --gen-completions zsh > ~/.zfunc/_fd
fd --gen-completions fish > ~/.config/fish/completions/fd.fish
fd --gen-completions powershell >> $PROFILE
```

Sources: [README.md:762-778](repo://README.md#L762-L778)

> [!NOTE]
> Debian and Ubuntu ship the binary as `fdfind`, because the name `fd` was already taken by another package. Link it as `fd` with `ln -s $(which fdfind) ~/.local/bin/fd` to follow these docs unchanged.

Sources: [README.md:563-573](repo://README.md#L563-L573)
