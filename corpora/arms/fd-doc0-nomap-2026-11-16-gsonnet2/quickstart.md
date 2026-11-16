---
title: "Quickstart"
---
## Overview

This page builds `fd` from source and runs the searches that exercise each part of the program. The crate is named `fd-find` and builds a binary called `fd` from `src/main.rs`; for the architecture, see [[fd Overview]].

Sources: [Cargo.toml:15-31](repo://Cargo.toml#L15-L31)

## Build

The crate needs Rust 1.90.0 or newer and uses the 2024 edition. The Makefile builds with `cargo build --profile $(PROFILE) --locked`.

Sources: [Cargo.toml:15-31](repo://Cargo.toml#L15-L31), [Makefile:9](repo://Makefile#L9)

```bash
cargo build --release --locked
./target/release/fd --help
```

Sources: [Makefile:9](repo://Makefile#L9)

Cargo features control two optional parts. `completions` is the default and enables `--gen-completions`; `use-jemalloc` switches the global allocator to jemalloc, and only takes effect on platforms the `cfg` in `main.rs` lists (not Windows, macOS, Android and a few others).

Sources: [Cargo.toml:94-98](repo://Cargo.toml#L94-L98), [src/main.rs:42-54](repo://src/main.rs#L42-L54), [src/main.rs:78-81](repo://src/main.rs#L78-L81)

## First searches

With one argument, `fd` searches the current directory recursively for entries whose name matches the pattern as a regular expression. With no search path given, it uses `./`; if the current directory no longer exists, it fails with an error.

Sources: [src/cli.rs:696-704](repo://src/cli.rs#L696-L704), [src/cli.rs:963-971](repo://src/cli.rs#L963-L971)

```bash
fd netfl              # names containing "netfl"
fd '^x.*rc$' /etc     # regex, in a given directory
fd -g '*.toml'        # glob instead of regex
fd -e rs              # by extension
fd -H -I secret       # include hidden and ignored files
```

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232), [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/main.rs:313-320](repo://src/main.rs#L313-L320)

- The pattern types and smart case are in [[Pattern Matching]].
- Why some files do not show up by default is in [[Directory Traversal and Ignore Rules]].
- `-e`, `--type`, `--size`, `--changed-within` and `--owner` are in [[Entry Filters]].

Sources: [src/walk.rs:526-591](repo://src/walk.rs#L526-L591)

## Running commands on results

`-x` runs a command once per result, in parallel. `-X` runs it once with all results as arguments. If the command has no placeholder, the path is appended.

Sources: [src/exec/mod.rs:219-256](repo://src/exec/mod.rs#L219-L256)

```bash
fd -e zip -x unzip
fd -g 'test_*.py' -X vim
fd -e jpg -x convert {} {.}.png
```

Sources: [src/cli.rs:896-915](repo://src/cli.rs#L896-L915)

Place `-x` last: every argument after it belongs to the command, unless you end it with `;`. Details are in [[Command Execution]].

Sources: [src/cli.rs:886-893](repo://src/cli.rs#L886-L893)

## Common errors

`fd` refuses a pattern that contains `/` unless `--full-path` is given, because patterns are matched against file names; the error message suggests `fd . 'dir'` to list a directory or `--full-path` to match whole paths. It also refuses a pattern that can only match names with a leading dot while hidden files are filtered, and suggests `--hidden`. See [[Pattern Matching]].

Sources: [src/main.rs:185-216](repo://src/main.rs#L185-L216), [src/main.rs:521-539](repo://src/main.rs#L521-L539)

Errors are printed as `[fd error]: ...` on stderr, and the exit code is 1; see [[Result Pipeline and Output]].

Sources: [src/main.rs:62-73](repo://src/main.rs#L62-L73), [src/error.rs:5-9](repo://src/error.rs#L5-L9)
