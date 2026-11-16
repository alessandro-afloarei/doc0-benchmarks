---
title: "Quickstart"
---
## Overview

This page builds fd from a clone, runs a few searches, and installs the binary with its shell completions and man page. fd is a Rust crate (`fd-find`) that needs Rust 1.90.0 or later; it builds one binary, `fd`, whose entry point is `src/main.rs` (see [[fd Architecture Overview]] for what happens inside it).

Sources: [Cargo.toml:1-31](repo://Cargo.toml#L1-L31), [README.md:720-728](repo://README.md#L720-L728)

## Build and run from source

1. Clone the repository and enter it.
2. Build a debug binary with `cargo build`; it lands in `target/debug/fd`.
3. Run the unit and integration tests with `cargo test` (the harness is described in [[Testing and CI]]).
4. Install it into Cargo's bin directory with `cargo install --path .`, or install the published crate with `cargo install fd-find`.

Sources: [README.md:734-747](repo://README.md#L734-L747), [README.md:720-725](repo://README.md#L720-L725)

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

Sources: [README.md:734-747](repo://README.md#L734-L747), [README.md:720-725](repo://README.md#L720-L725)

## Build profiles and features

The `release` profile enables link-time optimisation, a single codegen unit and symbol stripping. The `dev` profile keeps only line tables for fd itself and no debug info for dependencies; a `debugging` profile inherits from `dev` with full debug info when you need a debugger.

Sources: [Cargo.toml:79-92](repo://Cargo.toml#L79-L92)

| Feature | Enables | Default |
| --- | --- | --- |
| `completions` | `clap_complete` and the hidden `--gen-completions` flag | yes |
| `use-jemalloc` | the `tikv-jemallocator` global allocator on supported platforms | no |
| `base` | `use-jemalloc` | no |

Sources: [Cargo.toml:94-98](repo://Cargo.toml#L94-L98), [src/main.rs:42-54](repo://src/main.rs#L42-L54), [src/cli.rs:690-692](repo://src/cli.rs#L690-L692)

On Windows MSVC targets, `.cargo/config.toml` statically links the C runtime so the resulting executable does not depend on the vcruntime DLL.

Sources: [.cargo/config.toml:1-9](repo://.cargo/config.toml#L1-L9)

## Install with make

The `Makefile` builds `target/release/fd` with `cargo build --profile release --locked`, generates bash, fish and PowerShell completions by running the new binary with `--gen-completions <shell>`, copies the hand-written zsh and `fdfind` completions from `contrib/completion`, and installs everything under `prefix` (default `/usr/local`). `DESTDIR` is honoured for packaging.

Sources: [Makefile:1-52](repo://Makefile#L1-L52)

```bash
make            # build target/release/fd
make completions
sudo make install
```

Sources: [Makefile:8-9](repo://Makefile#L8-L9), [Makefile:11-12](repo://Makefile#L11-L12), [Makefile:44-52](repo://Makefile#L44-L52)

`--gen-completions` takes the shell as an optional value; without one, fd asks `clap_complete` to detect the shell from the environment. The program name written into the script is the stem of the executable fd was started as, so a binary installed as `fdfind` generates completions for `fdfind`.

Sources: [src/main.rs:114-129](repo://src/main.rs#L114-L129), [src/cli.rs:775-785](repo://src/cli.rs#L775-L785)

> [!NOTE]
> Debian and Ubuntu package the binary as `fdfind`, because the name `fd` is taken by another package. A symlink such as `ln -s $(which fdfind) ~/.local/bin/fd` restores the short name.

Sources: [README.md:542-553](repo://README.md#L542-L553)

## First searches

With no arguments fd lists everything under the current directory, recursively, skipping hidden and ignored entries. The first positional argument is a regular expression matched against each file name; the second and later positionals are the directories to search.

Sources: [README.md:37-90](repo://README.md#L37-L90), [src/cli.rs:628-670](repo://src/cli.rs#L628-L670)

```bash
fd                 # list everything below .
fd netfl           # names containing "netfl"
fd '^x.*rc$' /etc  # regex, searching /etc
fd -e md           # files with the .md extension
fd -g libc.so /usr # glob that must match the whole name
fd -H pre-commit   # include hidden files
fd -u pattern      # include hidden and ignored files
fd -p -g '**/.git/config'  # match against the full path
```

Sources: [README.md:37-152](repo://README.md#L37-L152)

How each kind of pattern is compiled, and why a pattern containing `/` is refused unless `--full-path` is given, is on [[Pattern Matching]]. What `-H`, `-I` and `-u` turn off is on [[Hidden Files, Ignore Rules and Exclusions]], and the full option set with its defaults is on [[Command-Line Options and Config]].

Sources: [src/main.rs:169-232](repo://src/main.rs#L169-L232), [src/main.rs:310-320](repo://src/main.rs#L310-L320)

## Running commands on results

`-x`/`--exec` runs a command once per result, in parallel; `-X`/`--exec-batch` runs it once with all results as arguments. Everything after `-x` belongs to the command, so put it last or end the command with `\;`. Placeholders such as `{}` and `{.}` stand for parts of each path.

Sources: [README.md:154-183](repo://README.md#L154-L183), [src/cli.rs:882-931](repo://src/cli.rs#L882-L931)

```bash
fd -e zip -x unzip                # unzip every archive
fd -e jpg -x convert {} {.}.png   # convert each jpg to png
fd -g 'test_*.py' -X vim          # open all matches in one vim
fd -e rs -l                       # ls -l style listing
```

Sources: [README.md:154-236](repo://README.md#L154-L236)

The placeholder rules are on [[Placeholder Templates]], and how commands are scheduled, batched and how their failures set the exit code is on [[Command Execution]].

Sources: [src/cli.rs:882-952](repo://src/cli.rs#L882-L952)
