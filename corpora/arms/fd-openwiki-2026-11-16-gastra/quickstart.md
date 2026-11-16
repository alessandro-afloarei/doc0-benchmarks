---
type: quickstart
title: Quickstart and task map
description: Build and try the fd filesystem search tool, learn its core defaults, and find focused guides for search, execution, output, development, and release work.
tags: [quickstart, navigation, usage, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:26:52.841Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
generated: { by: "codex", at: "2026-11-16T07:26:52.841Z" }
---

# Quickstart and task map

This repository implements `fd`, a filesystem entry search tool written in Rust. Cargo calls the package `fd-find` and builds the `fd` executable from `src/main.rs`. It searches names and paths, then prints matches or passes them to commands. Each invocation scans the filesystem; there is no persistent search index to build first. [Manifest](../Cargo.toml#L15-L31), [runtime entry](../src/main.rs#L75-L112).

## Build and try this checkout

Use Rust 1.90.0 or newer, as declared by the manifest. From the repository root:

```sh
cargo build --locked
cargo run --locked -- --help
cargo run --locked -- -e rs . src
cargo test --locked
```

The third command finds entries with the `rs` extension below `src`. The `.` is the search pattern; `src` is the root directory. For a release build, run `cargo build --locked --release` and use `target/release/fd` (`fd.exe` on Windows). See [building and packaging](operations/build-and-release.md) for features, completion generation, staged installation, and CI. [Toolchain declaration](../Cargo.toml#L19-L31), [development workflow](../README.md#L734-L747).

## Everyday searches

Examples below assume the built executable is available as `fd`:

| Task | Command |
| --- | --- |
| List entries below the current directory | `fd` |
| Find names containing a regex match | `fd 'test_.*' tests` |
| Match a quoted glob | `fd -g '*.rs' src` |
| Match an exact literal filename | `fd --exact Cargo.toml` |
| Require two patterns | `fd test --and env` |
| Search hidden and normally ignored entries | `fd -HI pattern` |
| Match directory components too | `fd --full-path 'src/exec'` |
| Ask only whether a match exists | `fd -q --exact Cargo.toml` |
| Count lines across Rust files with a batch command | `fd -t f -e rs . src -X wc -l` |

The default pattern is a regex against the filename, and all `--and` patterns must match. Smart case makes a search case-sensitive when a pattern contains uppercase, unless case behavior is explicitly overridden. Hidden entries and normal ignore rules are enabled by default; `-H` and `-I` control those policies separately. `--full-path` changes what gets matched, whereas `--absolute-path` changes returned paths. [Pattern setup](../src/main.rs#L94-L109), [case and configuration](../src/main.rs#L248-L255), [ignore policy](../src/main.rs#L310-L320).

Normal searches return success even when there are no matches. Quiet mode prints no results and returns `0` for a match or `1` for no match, making it useful in shell conditions. [Receiver behavior](../src/walk.rs#L198-L206), [completion status](../src/walk.rs#L281-L293).

## Choose a guide

| Your task or question | Start here |
| --- | --- |
| Understand roots, patterns, ignore files, pruning, or missing results | [Patterns, traversal, and filters](concepts/search-semantics.md) |
| Trace a search through threads, filters, channels, and shutdown | [Search pipeline and concurrency](architecture/search-pipeline.md) |
| Run a command for each path or build argument batches | [Running commands on search results](workflows/command-execution.md) |
| Pipe filenames, preserve bytes, understand sorting, color, or hyperlinks | [Output, paths, and shell pipelines](integrations/output-and-pipelines.md) |
| Build with features, install completions, package, or prepare a release | [Building, packaging, and releasing fd](operations/build-and-release.md) |
| Add regression coverage or extend a behavior | [Testing and extending search behavior](testing/contributor-guide.md) |

## Follow a change through the code

`src/cli.rs` declares the user interface. `src/main.rs` validates and translates options into `Config`, regexes, and command templates. `src/walk.rs` configures the `ignore` walker, applies filters, and routes bounded-channel results to printing or command consumers. `src/output.rs` owns listing presentation; `src/exec` owns child-process execution; `src/fmt` supplies shared path placeholders. The [architecture guide](architecture/search-pipeline.md) connects those responsibilities and identifies failure boundaries.

For a first regression test, inspect a neighboring case in `tests/tests.rs` and the `TestEnv` helper. Standard output assertions sort and normalize results; use raw process output when verifying bytes or ordering. The [testing guide](testing/contributor-guide.md) explains this distinction and gives focused commands. Existing public references remain useful: [README](../README.md), [man page](../doc/fd.1), [contribution guide](../CONTRIBUTING.md), and [release checklist](../doc/release-checklist.md).
