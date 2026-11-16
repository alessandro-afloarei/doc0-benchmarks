---
title: "Quickstart"
---
## Overview

This page builds `fd` from this repository, runs it, and runs its test suite. For how the program works inside, start from [[fd Overview]].

Sources: [Cargo.toml:21-24](repo://Cargo.toml#L21-L24)

## Build and run

The crate declares edition 2024 and a minimum Rust version of 1.90.0. Its binary is named `fd` and lives at `src/main.rs`.

Sources: [Cargo.toml:17-24](repo://Cargo.toml#L17-L24)

The Makefile builds with the release profile and `--locked`, so the build uses the versions in `Cargo.lock`:

Sources: [Makefile:8-9](repo://Makefile#L8-L9)

```make
$(EXE): Cargo.toml src/**/*.rs
	cargo build --profile $(PROFILE) --locked
```

Sources: [Makefile:1-9](repo://Makefile#L1-L9)

A plain `cargo build` produces a debug binary. Run it from the repository, with a pattern and an optional directory:

Sources: [src/cli.rs:696-721](repo://src/cli.rs#L696-L721)

```bash
cargo run -- netfl          # entries whose name contains "netfl", under the current directory
cargo run -- '^x.*rc$' /etc # a regex, searched under /etc
cargo run -- -e rs -x wc -l # every .rs file, passed to `wc -l`
```

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112)

The three invocations correspond to a pattern alone, a pattern with a root directory, and `--exec`. How each is processed is in [[Startup and Configuration]] and [[Command Execution]].

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112), [src/cli.rs:696-721](repo://src/cli.rs#L696-L721)

## Cargo features

| Feature | Effect |
| --- | --- |
| `completions` | Enables `--gen-completions` through `clap_complete`; on by default |
| `use-jemalloc` | Uses `tikv-jemallocator` as the global allocator on the platforms `main.rs` lists |
| `base` | Shorthand for `use-jemalloc` |

Sources: [Cargo.toml:94-98](repo://Cargo.toml#L94-L98), [src/main.rs:38-55](repo://src/main.rs#L38-L55)

The release profile turns on link-time optimization.

Sources: [Cargo.toml:107-108](repo://Cargo.toml#L107-L108)

## Install and completions

`make install` builds the executable, produces completion files with `fd --gen-completions <shell>` (or copies the ones in `contrib/completion`), and installs the binary, the completions and `doc/fd.1` under `prefix`.

Sources: [Makefile:11-52](repo://Makefile#L11-L52)

## Run the tests

All tests are Rust tests: unit tests live beside the code (for example the filter parsers), and integration tests are in `tests/tests.rs`. Run both with:

Sources: [.github/workflows/CICD.yml:80-84](repo://.github/workflows/CICD.yml#L80-L84)

```bash
cargo test --locked
```

Sources: [.github/workflows/CICD.yml:80-84](repo://.github/workflows/CICD.yml#L80-L84)

Each integration test builds a `TestEnv`. It creates a temporary directory with a fake `.git` directory (so `.gitignore` is honoured), the requested directories and files, a symlink `symlink` to `one/two`, a `.fdignore` that lists `fdignored.foo` and a `.gitignore` that lists `gitignored.foo`.

Sources: [tests/testenv/mod.rs:28-61](repo://tests/testenv/mod.rs#L28-L61)

The environment runs the compiled `fd` binary as a subprocess in that directory. It unsets `LS_COLORS` for stable colours and passes `--no-global-ignore-file` unless the test set up its own global ignore file.

Sources: [tests/testenv/mod.rs:300-316](repo://tests/testenv/mod.rs#L300-L316)

`assert_output` compares output after sorting lines, so a test does not depend on result order:

Sources: [tests/testenv/mod.rs:114-134](repo://tests/testenv/mod.rs#L114-L134)

```rust
te.assert_output(&["a.foo"], "a.foo");
te.assert_output(&["b.foo"], "one/b.foo");
```

Sources: [tests/tests.rs:64-69](repo://tests/tests.rs#L64-L69), [tests/testenv/mod.rs:114-134](repo://tests/testenv/mod.rs#L114-L134)

## Checks run in CI

Pull requests run `cargo fmt -- --check`, `cargo clippy --all-targets --all-features -- -Dwarnings` and the tests. Run the first two locally before opening a pull request.

Sources: [.github/workflows/CICD.yml:41-64](repo://.github/workflows/CICD.yml#L41-L64)

If a change alters behaviour, `CONTRIBUTING.md` asks for an entry in the "Upcoming release" section of `CHANGELOG.md`.

Sources: [CONTRIBUTING.md:21-28](repo://CONTRIBUTING.md#L21-L28)
