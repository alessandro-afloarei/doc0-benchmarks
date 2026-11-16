---
title: "Quickstart"
---
## Overview

This page builds `fd` from a checkout, runs a few searches that exercise the main parts of the search pipeline, and installs shell completions. Each search below names the page that explains how fd carries it out; [[fd Overview]] shows how those parts fit together.

Sources: [README.md:734-747](repo://README.md#L734-L747)

## Build and test

The crate needs Rust 1.90.0 or later (edition 2024). From a clone of the repository, build, test and install with cargo.

Sources: [Cargo.toml:16-21](repo://Cargo.toml#L16-L21)

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

The default feature set is `completions`, which pulls in `clap_complete` for `--gen-completions`. The `base` feature enables `use-jemalloc`, which selects jemalloc as the allocator on the targets listed in `src/main.rs`. The release profile uses LTO, a single codegen unit and stripped symbols.

Sources: [Cargo.toml:89-98](repo://Cargo.toml#L89-L98), [src/main.rs:42-54](repo://src/main.rs#L42-L54)

The `Makefile` builds a release binary with `cargo build --profile release --locked`, generates bash, fish and PowerShell completions by running the binary, copies the zsh and `fdfind` completions from `contrib/completion`, and `make install` puts the binary, completions and the `doc/fd.1` man page under `prefix` (default `/usr/local`).

Sources: [Makefile:1-52](repo://Makefile#L1-L52)

## First searches

Run `fd` with one argument to search the current directory recursively for entries whose name contains the pattern. The pattern is a regular expression, and a second argument names the directory to search.

Sources: [README.md:40-73](repo://README.md#L40-L73)

```bash
fd netfl
fd '^x.*rc$'
fd passwd /etc
```

Sources: [README.md:40-73](repo://README.md#L40-L73)

How the pattern becomes a regex, and why it is matched against the file name only, is in [[Pattern Matching]]. With no pattern at all, fd lists everything; to list a specific directory you need a match-all pattern such as `.`, because the first positional argument is the pattern. fd refuses a pattern that contains `/` and suggests `fd . 'dir'` or `--full-path` instead.

Sources: [README.md:75-94](repo://README.md#L75-L94), [src/main.rs:185-216](repo://src/main.rs#L185-L216)

| Goal | Command | Explained in |
| --- | --- | --- |
| Files with an extension | `fd -e md` | [[Pattern Matching]] |
| Exact file name by glob | `fd -g libc.so /usr` | [[Pattern Matching]] |
| Include hidden files | `fd -H pre-commit` | [[Ignore Rules and Hidden Files]] |
| Include `.gitignore`d files | `fd -I num_cpu` | [[Ignore Rules and Hidden Files]] |
| Everything (`-HI`) | `fd -u pattern` | [[Ignore Rules and Hidden Files]] |
| Match the whole path | `fd -p '.*/lesson-\d+/[a-z]+.(jpg\|png)'` | [[Pattern Matching]] |
| Only regular files | `fd -tf` | [[Entry Filters]] |

Sources: [README.md:96-152](repo://README.md#L96-L152), [README.md:214-217](repo://README.md#L214-L217)

## Run commands on results

`-x`/`--exec` runs a command once per result, in parallel; `-X`/`--exec-batch` runs it once with all results as arguments. Positional arguments after `-x` belong to the command, so put `-x` last or end the command with `\;`. Without a placeholder, fd appends `{}`.

Sources: [README.md:154-233](repo://README.md#L154-L233)

```bash
fd -e zip -x unzip
fd -e jpg -x convert {} {.}.png
fd -g 'test_*.py' -X vim
fd -e cpp -e cxx -e h -e hpp -X rg 'std::cout'
```

Sources: [README.md:154-233](repo://README.md#L154-L233)

`-l`/`--list-details` is a shortcut for running `ls -lhd` on the results in batch mode. [[Command Execution]] covers both modes and the `ls` command chosen per platform, and [[Format Templates]] covers the placeholders `{}`, `{.}`, `{/}`, `{//}` and `{/.}`.

Sources: [README.md:192-198](repo://README.md#L192-L198), [src/main.rs:395-410](repo://src/main.rs#L395-L410)

## Shell completions

With the `completions` feature, `fd --gen-completions <shell>` prints a completion script for the shell. `print_completions` takes the program name from the first argument's file stem, so a binary installed as `fdfind` completes as `fdfind`.

Sources: [src/main.rs:114-129](repo://src/main.rs#L114-L129)

```bash
fd --gen-completions bash > ~/.local/share/bash-completion/completions/fd
fd --gen-completions zsh > ~/.zfunc/_fd
fd --gen-completions fish > ~/.config/fish/completions/fd.fish
fd --gen-completions powershell >> $PROFILE
```

Sources: [README.md:762-778](repo://README.md#L762-L778)
