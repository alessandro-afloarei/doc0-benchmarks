---
title: "Quickstart"
---
## Overview

This page builds `fd` from source, runs its tests, and walks through the first searches. `fd` needs Rust 1.90.0 or later, and `make` for the release build and completion files. For what happens inside a search, see [[Overview]] and [[Search and Execution Pipeline]].

Sources: [README.md:720-728](repo://README.md#L720-L728), [Cargo.toml:19-21](repo://Cargo.toml#L19-L21)

## Build and test

Install the published crate with `cargo install fd-find`, or work from a clone:

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

`make` builds the release binary at `target/release/fd` with `cargo build --profile release --locked`. The release profile turns on LTO, strips symbols and uses one codegen unit. The `use-jemalloc` feature (part of `base`) swaps in jemalloc as the global allocator on the platforms `main.rs` lists.

Sources: [Makefile:1-9](repo://Makefile#L1-L9), [Cargo.toml:89-98](repo://Cargo.toml#L89-L98), [src/main.rs:38-54](repo://src/main.rs#L38-L54)

## First searches

### Search by name

With one argument, `fd` searches the current directory recursively for entries whose name contains the pattern. The pattern is a regular expression, and a second argument names the directory to search:

Sources: [README.md:40-73](repo://README.md#L40-L73)

```bash
fd netfl
fd '^x.*rc$'
fd passwd /etc
```

Sources: [README.md:40-73](repo://README.md#L40-L73)

### Filter by extension or glob

`-e` keeps entries with an extension, alone or with a pattern; `-g` matches a glob instead of a regex:

Sources: [README.md:96-122](repo://README.md#L96-L122)

```bash
fd -e md
fd -e rs mod
fd -g libc.so /usr
```

Sources: [README.md:96-122](repo://README.md#L96-L122)

### Include hidden and ignored files

Hidden files and anything matched by `.gitignore` are skipped by default. `-H` adds hidden files, `-I` drops the ignore rules, and `-u` (or `-HI`) does both. `-p` matches the pattern against the full path instead of the file name:

Sources: [README.md:124-152](repo://README.md#L124-L152)

```bash
fd -H pre-commit
fd -I num_cpu
fd -u -p -g '**/.git/config'
```

Sources: [README.md:124-152](repo://README.md#L124-L152)

> [!NOTE]
> A pattern holding `/` cannot match a file name, so without `--full-path` `fd` refuses it and suggests `fd . 'dir'` or `fd --full-path 'pattern'`.

Sources: [src/main.rs:169-216](repo://src/main.rs#L169-L216)

## Run commands on results

`-x` runs a command once per result, in parallel; `-X` runs it once with every result as arguments. Put `-x` or `-X` last, because every argument after it belongs to the command:

Sources: [README.md:154-216](repo://README.md#L154-L216)

```bash
fd -e zip -x unzip
fd -g 'test_*.py' -X vim
fd -e jpg -x convert {} {.}.png
```

Sources: [README.md:154-216](repo://README.md#L154-L216)

| Placeholder | Replaced by | Example |
| --- | --- | --- |
| `{}` | The path of the result | `documents/images/party.jpg` |
| `{.}` | The path without its extension | `documents/images/party` |
| `{/}` | The basename | `party.jpg` |
| `{//}` | The parent directory | `documents/images` |
| `{/.}` | The basename without its extension | `party` |

Sources: [README.md:219-235](repo://README.md#L219-L235)

A command template without a placeholder gets `{}` appended. `-j`/`--threads` sets the number of parallel `-x` jobs, and `--threads=1` runs them one after another. `-l`/`--list-details` is a shortcut for `-X ls -lhd`.

Sources: [README.md:192-198](repo://README.md#L192-L198), [README.md:235-241](repo://README.md#L235-L241)

## Shell completions

The default `completions` feature lets `fd` print a completion script for a shell:

Sources: [README.md:762-778](repo://README.md#L762-L778), [src/main.rs:114-129](repo://src/main.rs#L114-L129)

```bash
fd --gen-completions bash > ~/.local/share/bash-completion/completions/fd
fd --gen-completions zsh > ~/.zfunc/_fd
fd --gen-completions fish > ~/.config/fish/completions/fd.fish
fd --gen-completions powershell >> $PROFILE
```

Sources: [README.md:762-778](repo://README.md#L762-L778), [src/main.rs:114-129](repo://src/main.rs#L114-L129)

`make completions` writes the same scripts into `autocomplete/`, and copies the hand-written zsh and `fdfind` scripts from `contrib/completion/`.

Sources: [Makefile:11-40](repo://Makefile#L11-L40)
