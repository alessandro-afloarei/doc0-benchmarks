---
title: "Quickstart"
---
## Overview

This page gets `fd` built from this repository and walks through the searches most people run first. It assumes a Rust toolchain at or above the minimum supported version, which `Cargo.toml` sets to 1.90.0 with the 2024 edition.

Sources: [Cargo.toml:19-21](repo://Cargo.toml#L19-L21), [README.md:720-728](repo://README.md#L720-L728)

## Build and install

### With cargo

Clone the repository, then build, test and install with the usual cargo commands. `cargo test` runs both the unit tests inside the modules and the integration tests in `tests/` (see [[Testing]]).
Sources: [README.md:734-747](repo://README.md#L734-L747)


```bash
git clone https://github.com/sharkdp/fd
cd fd
cargo build
cargo test
cargo install --path .
```

Sources: [README.md:734-747](repo://README.md#L734-L747)

The published crate is called `fd-find`, so `cargo install fd-find` installs a release from crates.io. Distribution packages on Debian and Ubuntu name the binary `fdfind` because another package already owns `fd`; the README suggests linking it to `~/.local/bin/fd`.

Sources: [Cargo.toml:17-18](repo://Cargo.toml#L17-L18), [README.md:542-560](repo://README.md#L542-L560)

### With make

The `Makefile` builds the release binary with `cargo build --profile release --locked`, generates bash, fish and PowerShell completions by running the binary with `--gen-completions`, copies the hand-written zsh completions from `contrib/completion`, and installs the binary, completions and the `doc/fd.1` man page under `prefix` (default `/usr/local`). `DESTDIR` is honoured for staged installs.
Sources: [Makefile:1-52](repo://Makefile#L1-L52)


```bash
make install prefix=$HOME/.local
```

Sources: [Makefile:1-52](repo://Makefile#L1-L52)

### Shell completions

Completions come from the hidden `--gen-completions` option, which is only compiled in with the default `completions` feature. With no shell name it guesses the shell from the environment.
Sources: [README.md:762-778](repo://README.md#L762-L778), [src/cli.rs:775-785](repo://src/cli.rs#L775-L785), [src/main.rs:114-129](repo://src/main.rs#L114-L129)


```bash
fd --gen-completions bash > ~/.local/share/bash-completion/completions/fd
fd --gen-completions zsh > ~/.zfunc/_fd
fd --gen-completions fish > ~/.config/fish/completions/fd.fish
```

Sources: [README.md:762-778](repo://README.md#L762-L778), [src/cli.rs:775-785](repo://src/cli.rs#L775-L785), [src/main.rs:114-129](repo://src/main.rs#L114-L129)

## First searches

### Find by name

With one argument, fd searches the current directory recursively for entries whose *name* contains a match for the pattern. The pattern is a regular expression, matched case-insensitively unless it contains an uppercase letter. A second argument names the directory to search instead of the current one; with no pattern at all, fd lists everything.
Sources: [README.md:40-95](repo://README.md#L40-L95), [src/cli.rs:628-659](repo://src/cli.rs#L628-L659)


```bash
fd netfl                 # names containing "netfl"
fd '^x.*rc$' /etc        # regex, rooted at /etc
fd                       # list every entry below .
fd . some/dir            # list every entry below some/dir
```

Sources: [README.md:40-95](repo://README.md#L40-L95), [src/cli.rs:628-659](repo://src/cli.rs#L628-L659)

A pattern containing `/` never matches a file name, so fd refuses it with a hint to use `fd . 'dir'` or `--full-path`. [[Search Patterns and Configuration]] explains this check and smart case.

Sources: [src/main.rs:150-216](repo://src/main.rs#L150-L216)

### Extensions, globs and exact names

`-e` filters by extension and can be repeated; `-g` switches the pattern to a glob that must match the whole name; `--exact` matches the whole name literally; `-F` treats the pattern as a literal substring.
Sources: [README.md:96-123](repo://README.md#L96-L123), [src/main.rs:218-232](repo://src/main.rs#L218-L232)


```bash
fd -e md                 # all Markdown files
fd -e rs mod             # .rs files whose name contains "mod"
fd -g libc.so /usr       # exactly "libc.so"
fd -F 'a.b'              # literal "a.b", not a regex
```

Sources: [README.md:96-123](repo://README.md#L96-L123), [src/main.rs:218-232](repo://src/main.rs#L218-L232)

### Hidden and ignored files

By default fd skips hidden entries and anything matched by `.gitignore`, `.ignore` or `.fdignore`. `-H` includes hidden entries, `-I` stops reading ignore files, and `-u` does both. [[Ignore Rules and Traversal]] lists every rule source.
Sources: [README.md:124-144](repo://README.md#L124-L144), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128)


```bash
fd -H pre-commit
fd -I num_cpu
fd -u secret
```

Sources: [README.md:124-144](repo://README.md#L124-L144), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128)

### Run a command on results

`-x` runs a command once per result, in parallel; `-X` runs it once with all results as arguments. Placeholders such as `{}` and `{.}` stand for the result path; without one, fd appends `{}`. Put `-x` last, since every argument after it belongs to the command. [[Command Execution]] and [[Placeholder Templates]] cover both in depth.
Sources: [README.md:154-241](repo://README.md#L154-L241)


```bash
fd -e zip -x unzip
fd -e jpg -x convert {} {.}.png
fd -g 'test_*.py' -X vim
fd -e rs -l              # ls -l style listing
```

Sources: [README.md:154-241](repo://README.md#L154-L241)

## Where to go next

The option reference with defaults and overrides is on [[Command-Line Interface]]. To understand why a file does or does not appear, follow [[Ignore Rules and Traversal]] and then [[Entry Filters]]; for exit statuses in scripts (including `-q`), see [[Exit Codes and Errors]].

Sources: [src/cli.rs:21-31](repo://src/cli.rs#L21-L31)
