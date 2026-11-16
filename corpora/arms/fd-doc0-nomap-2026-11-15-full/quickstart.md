---
title: "Quickstart"
---
## Overview

This page gets `fd` onto your machine and runs the searches most people need on day one: a plain pattern, a root directory, an extension, a glob, hidden and ignored files, and a command run on each result. [[Command-Line Options]] lists every flag.

Sources: [README.md:34-152](repo://README.md#L34-L152)

## Install

### From a package manager

Most distributions package `fd`. On Debian and Ubuntu the package is `fd-find` and the binary is named `fdfind`, because the name `fd` is taken by another package; link it to `fd` to follow these docs.

Sources: [README.md:542-575](repo://README.md#L542-L575)

```bash
apt install fd-find
ln -s $(which fdfind) ~/.local/bin/fd
```

Sources: [README.md:545-553](repo://README.md#L545-L553)

### From source

Building needs Rust 1.90.0 or later (the crate's `rust-version`) and `make`. Install the released crate with cargo, or build a clone.

Sources: [README.md:720-747](repo://README.md#L720-L747), [Cargo.toml:16-21](repo://Cargo.toml#L16-L21)

```bash
cargo install fd-find

# or, from a clone
git clone https://github.com/sharkdp/fd
cd fd
cargo build
cargo test
cargo install --path .
```

Sources: [README.md:722-747](repo://README.md#L722-L747)

`make install` builds the release binary with `cargo build --profile release --locked`, generates completions, and installs the binary, the completions and the `doc/fd.1` man page under `prefix` (default `/usr/local`).

Sources: [Makefile:1-52](repo://Makefile#L1-L52)

## First searches

1. Search the current directory recursively for entries whose name contains a pattern: `fd netfl`.
2. Use a regular expression: `fd '^x.*rc$'` finds names starting with `x` and ending in `rc`.
3. Give a root directory as the second argument: `fd passwd /etc`.
4. List everything below a directory with a match-all pattern: `fd . fd/tests/`. With no arguments at all, `fd` lists the current directory recursively.
5. Filter by extension: `fd -e md`, or combine it with a pattern: `fd -e rs mod`.
6. Match a whole name with a glob: `fd -g libc.so /usr`.
7. Include hidden entries with `-H`, ignored entries with `-I`, or both with `-u`.
8. Match against the full path instead of the name: `fd -p -g '**/.git/config'`.

Sources: [README.md:40-152](repo://README.md#L40-L152)

> [!WARNING]
> A pattern holding `/` matches nothing unless `--full-path` is set, so `fd` refuses it and suggests `fd . 'dir'` or `fd --full-path 'dir'` instead.

Sources: [src/main.rs:169-216](repo://src/main.rs#L169-L216)

## Act on the results

`-x`/`--exec` runs a command for each result, in parallel; `-X`/`--exec-batch` runs it once with all results as arguments. Put `-x` last, since every argument after it belongs to the command. Placeholders such as `{}` and `{.}` shape each argument; without a placeholder, `{}` is appended.

Sources: [README.md:154-241](repo://README.md#L154-L241)

```bash
fd -e zip -x unzip
fd -e jpg -x convert {} {.}.png
fd -g 'test_*.py' -X vim
fd -H '^\.DS_Store$' -tf -X rm
```

Sources: [README.md:164-207](repo://README.md#L164-L207), [README.md:281-293](repo://README.md#L281-L293)

`-l`/`--list-details` is a shortcut for running `ls -lhd` on all results. [[Command Execution]] and [[Format Templates and Placeholders]] cover the details.

Sources: [README.md:192-198](repo://README.md#L192-L198), [src/main.rs:395-410](repo://src/main.rs#L395-L410)

## Shell completions

Release archives ship completion files in an `autocomplete` directory. A build with the default `completions` feature also prints them on demand with `--gen-completions`, naming the program after the binary it was started as, so an `fdfind` binary completes as `fdfind`.

Sources: [README.md:749-778](repo://README.md#L749-L778), [src/main.rs:114-129](repo://src/main.rs#L114-L129)

```bash
fd --gen-completions bash > ~/.local/share/bash-completion/completions/fd
fd --gen-completions zsh > ~/.zfunc/_fd
fd --gen-completions fish > ~/.config/fish/completions/fd.fish
```

Sources: [README.md:766-778](repo://README.md#L766-L778)
