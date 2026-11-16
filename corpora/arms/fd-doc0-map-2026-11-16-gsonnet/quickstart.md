---
title: "Quickstart"
---
## Overview

This page shows how to build `fd` from this repository, try a few searches, and run the integration tests. For what happens inside a search, start from [[fd Overview]]. The crate is `fd-find` and it builds one binary named `fd` from `src/main.rs`.

Sources: [Cargo.toml:15-27](repo://Cargo.toml#L15-L27)

## Build

Build with Cargo, which needs Rust 1.90.0 or newer on the 2024 edition. The release profile enables LTO, strips symbols and uses one codegen unit.

Sources: [Cargo.toml:15-27](repo://Cargo.toml#L15-L27), [Cargo.toml:89-92](repo://Cargo.toml#L89-L92)

```bash
cargo build --release
```

Sources: [Cargo.toml:89-92](repo://Cargo.toml#L89-L92)

Cargo features control two optional pieces. `completions` is on by default and pulls in `clap_complete` for `--gen-completions`. `use-jemalloc` is off by default; `base` enables it. The allocator is only installed on platforms listed in the cfg block in `main.rs`.

Sources: [Cargo.toml:94-98](repo://Cargo.toml#L94-L98), [src/main.rs:42-54](repo://src/main.rs#L42-L54)

The `Makefile` builds a locked release binary into `target/release/fd`, generates shell completions by running that binary with `--gen-completions`, and installs the binary, completions and the man page `doc/fd.1` under `prefix` (`/usr/local` by default).

Sources: [Makefile:1-12](repo://Makefile#L1-L12), [Makefile:14-22](repo://Makefile#L14-L22), [Makefile:44-52](repo://Makefile#L44-L52)

```bash
make
make install prefix=/usr
```

Sources: [Makefile:1-12](repo://Makefile#L1-L12), [Makefile:44-52](repo://Makefile#L44-L52)

## Try it

The first positional argument is the pattern; further positional arguments are search paths. With no path, fd searches the current directory. Patterns are regexes unless `--glob`, `--fixed-strings` or `--exact` is given (see [[Pattern and Config Setup]]).

Sources: [src/cli.rs:696-721](repo://src/cli.rs#L696-L721), [src/main.rs:218-232](repo://src/main.rs#L218-L232)

```bash
fd netfl                          # file names containing "netfl"
fd -e rs -t f . src               # Rust files under src/
fd -H -I '^\.env'                 # include hidden and ignored entries
fd -e jpg -x convert {} {.}.png   # run a command per match
```

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232), [src/cli.rs:894-919](repo://src/cli.rs#L894-L919)

The last command uses placeholders, described in [[Format Templates and Placeholders]] and [[Command Execution]]. Hidden-file and ignore behaviour is in [[Traversal and Result Pipeline]].

Sources: [src/cli.rs:894-919](repo://src/cli.rs#L894-L919), [src/walk.rs:347-404](repo://src/walk.rs#L347-L404)

## Run the tests

Unit tests sit next to the code in `#[cfg(test)]` modules. Integration tests live in `tests/tests.rs` and drive the compiled binary through `TestEnv` in `tests/testenv/mod.rs`.

Sources: [tests/tests.rs:1-26](repo://tests/tests.rs#L1-L26), [tests/testenv/mod.rs:14-30](repo://tests/testenv/mod.rs#L14-L30)

```bash
cargo test
```

Sources: [tests/testenv/mod.rs:14-30](repo://tests/testenv/mod.rs#L14-L30)

Each test builds a `TestEnv`: a fresh temporary directory with the given directories and files, an empty `.git` directory so that `.gitignore` is honoured, a `symlink` to `one/two`, a `.fdignore` listing `fdignored.foo` and a `.gitignore` listing `gitignored.foo`.

Sources: [tests/testenv/mod.rs:33-63](repo://tests/testenv/mod.rs#L33-L63)

The harness finds the binary through `CARGO_BIN_EXE_fd` and runs it in that directory. It passes `--no-global-ignore-file` unless a test supplied its own global ignore file through `XDG_CONFIG_HOME`, and clears `LS_COLORS` so colour output is deterministic.

Sources: [tests/testenv/mod.rs:73-77](repo://tests/testenv/mod.rs#L73-L77), [tests/testenv/mod.rs:300-317](repo://tests/testenv/mod.rs#L300-L317)

Assertions such as `assert_output` compare stdout after `normalize_output`, which turns `\0` into `NULL` plus a newline, converts `/` to the platform separator and sorts the lines, so tests do not depend on the order in which the parallel walk delivers results. A mismatch panics with a diff of expected against actual.

Sources: [tests/testenv/mod.rs:114-136](repo://tests/testenv/mod.rs#L114-L136), [tests/testenv/mod.rs:248-252](repo://tests/testenv/mod.rs#L248-L252), [tests/testenv/mod.rs:96-113](repo://tests/testenv/mod.rs#L96-L113)

The shared fixtures in `tests/tests.rs` are plain lists of directories and files:

```rust
static DEFAULT_DIRS: &[&str] = &["one/two/three", "one/two/three/directory_foo"];
```

Sources: [tests/tests.rs:16-16](repo://tests/tests.rs#L16-L16)

> [!NOTE]
> `CONTRIBUTING.md` asks contributors to open an issue before a pull request and to add a line under "Upcoming release" in `CHANGELOG.md` when behaviour changes.

Sources: [CONTRIBUTING.md:9-10](repo://CONTRIBUTING.md#L9-L10), [CONTRIBUTING.md:28-33](repo://CONTRIBUTING.md#L28-L33)
