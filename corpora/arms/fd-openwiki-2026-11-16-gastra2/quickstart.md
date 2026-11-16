---
type: quickstart
title: Getting started with fd
description: Build and try the fd file finder, understand its search defaults, and navigate the repository's architecture and development workflows.
tags: [quickstart, navigation, search, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:13:39.635Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-47d76f6cde81cde2b78e68be
    resource: repo://src/exec/mod.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "codex", at: "2026-11-16T17:13:39.635Z" }
---

# Getting started with fd

This repository builds `fd`, a command-line finder for filesystem entries. It searches names and paths using parallel traversal, with hidden and ignored entries excluded by default. The Cargo package is named `fd-find`; the executable is named `fd`. This checkout requires Rust 1.90.0 or newer and uses edition 2024. See [Cargo.toml](../Cargo.toml#L16-L31).

## Build and try this checkout

From the repository root:

```sh
cargo build --locked
cargo run --locked -- --help
cargo run --locked -- -e rs . src
cargo test --locked
```

The third command searches `src` for Rust-extension entries. `cargo run --` separates Cargo arguments from fd arguments. The compiled development binary is available as `target/debug/fd` (`fd.exe` on Windows). For profiles, optional features, CI-equivalent checks, and installation, use the [build, test and release guide](operations/build-test-release.md).

## Everyday searches

The examples below assume the built binary is available as `fd`:

| Task | Command |
| --- | --- |
| List entries recursively below the working directory | `fd` |
| Search filenames by regex | `fd '^test_.*\.rs$'` |
| Search a specific directory | `fd . src` |
| Find a literal whole filename | `fd --exact 'Cargo.toml'` |
| Find literal text within filenames | `fd -F 'test_'` |
| Search using a glob | `fd -g '*.rs'` |
| Require two patterns | `fd test --and env` |
| Search only files with an extension | `fd -t f -e rs` |
| Include hidden and automatically ignored entries | `fd -HI PATTERN` |
| Match path components as well as filenames | `fd --full-path 'src/exec'` |
| Test for at least one matching file | `fd -q -t f -e rs` |

The first positional argument is a pattern, not the directory to traverse. Supply `.` followed by a directory to list that directory's descendants. Normal matching uses only the filename; full-path matching uses absolute path text. Smart case makes patterns insensitive unless uppercase content requests sensitivity, with explicit case flags available. `--and` requires every supplied pattern to match. See [patterns and filters](concepts/patterns-and-filters.md).

Ordinary searches return success even with no matches. `--quiet` changes that contract to 0 for a match and 1 for none. Small searches may print sorted results; larger or slower searches stream and do not guarantee ordering. See [output and pipelines](workflows/output-and-pipelines.md) before depending on output order or parsing filenames.

## Act on matches

```sh
# Count each matching file separately
fd -t f -e rs -x wc -l

# Supply matches together, subject to batch and argument limits
fd -t f -e rs -X wc -l
```

These examples require `wc` on the executable search path. `-x` executes per result, normally in parallel; `-X` groups results into process arguments. Both append a path placeholder if none is present. Put the execution option last. fd launches a process directly, so shell aliases and shell syntax are not automatically interpreted. Read [command execution](workflows/command-execution.md) for placeholders, serial operation, empty matches and failure behavior.

## Find the right explanation

| Question or change | Start here |
| --- | --- |
| How does a CLI option reach the search engine? | [Search pipeline and state ownership](architecture/search-pipeline.md) |
| Why is an entry absent, or a directory never visited? | [Parallel traversal and ignore rules](architecture/traversal-and-ignores.md) |
| How do regexes, exact matching, size, time or owner filters combine? | [Pattern matching and metadata filters](concepts/patterns-and-filters.md) |
| How do I preserve unusual filename bytes or customize displayed output? | [Output formatting and shell pipelines](workflows/output-and-pipelines.md) |
| How are commands batched, ordered and checked for failure? | [Executing commands over search results](workflows/command-execution.md) |
| How do I run focused tests, update completions or prepare a release? | [Building, testing, and releasing fd](operations/build-test-release.md) |

The core flow is `Opts` → resolved `Config` and regexes → parallel ignore-aware walker → filters → bounded result channel → printing or execution. Begin in `src/main.rs` for startup, `src/cli.rs` for the public CLI, and `src/walk.rs` for traversal and receiver behavior. The architecture pages explain the boundaries rather than requiring a file-by-file read.

## When a search surprises you

For missing files, compare with `-HI`, then inspect explicit exclusions, marker pruning, depth, link-following and metadata filters. Hidden and ignore-file controls are independent. Use `--show-errors` to reveal traversal diagnostics. For path patterns, use `--full-path`; `/` in a filename-only pattern is rejected with guidance. For literal punctuation, choose `--exact` or `--fixed-strings` instead of regex interpretation.

The [README](../README.md) contains broader usage and installation examples, [doc/fd.1](../doc/fd.1) is the man page, and [CONTRIBUTING.md](../CONTRIBUTING.md) explains contribution expectations. Source and focused tests remain authoritative for behavior as the repository evolves.
