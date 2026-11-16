---
type: quickstart
title: Getting started with fd
description: Build and try fd from this checkout, understand its default search policy, and find the subsystem documentation for common user and contributor tasks.
tags: [quickstart, navigation, search, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:51.346Z
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
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
generated: { by: "codex", at: "2026-11-16T06:05:51.346Z" }
---

# Getting started with fd

`fd` searches filesystem entry names and can print paths or run commands on matches. This repository contains the Rust package `fd-find` and its `fd` executable. The main runtime flow is argument parsing, configuration and regex compilation, parallel directory traversal, then output or command execution. It searches the filesystem during an invocation rather than maintaining an index.

## Build and try this checkout

Use Rust 1.90.0 or newer, as declared by `Cargo.toml`, and run from the repository root:

```sh
cargo build --locked
cargo run --locked -- --help
cargo run --locked -- -t f -e rs . src
cargo test --locked
```

The third command searches beneath `src` for regular files with the `rs` suffix. `cargo run` accepts fd arguments after `--`; a standalone local build is available as `target/debug/fd` on Unix or `target/debug/fd.exe` on Windows. Install the checkout with `cargo install --locked --path .` when desired. See [development, testing, and release](development/build-test-release.md) for features, debugging profiles, completions, CI, and packaging.

## Search basics

The invocation shape is `fd [OPTIONS] [pattern [path]...]`. With no arguments, fd recursively lists visible, nonignored descendants of the current directory. The first positional argument is always a pattern; to list a specific root, use `fd . src/`, not `fd src/`.

Examples below assume the desired `fd` executable is on `PATH`; substitute the local build path when comparing this checkout:

```sh
fd main
fd '^test_.*\.rs$' tests
fd -g '*.rs' src
fd --exact Cargo.toml
fd -t f -e rs -e toml
fd foo --and bar
```

Regex is the default. Matching uses entry basenames and smart case: lowercase patterns are normally insensitive, while uppercase content can enable case sensitivity across the primary and additional patterns. Use `-i` or `-s` to choose explicitly, `-F` for literal substrings, and `--exact` for a whole literal name. `--and` requires all patterns to match the same entry.

`-p`/`--full-path` matches an absolute path; `-a`/`--absolute-path` makes result paths absolute. Those options serve separate purposes. Details and path diagnostics are in [patterns and paths](search/patterns-and-paths.md).

## Why a file may be absent

The defaults exclude hidden entries and respect enabled ignore sources, including `.ignore`, `.fdignore`, and Git ignore rules when Git repository detection applies. `-H` includes hidden entries, `-I` disables automatic ignore sources, and `-u` combines both. Other restrictions, including explicit exclusions, marker files, depth and metadata filters, still apply.

```sh
fd -u pattern
fd -H -E .git pattern
fd --show-errors pattern
fd -L pattern
```

These commands respectively broaden visibility, include hidden entries while excluding `.git`, show traversal errors, and follow symlinked directories. fd does not follow descendant symlinked directories by default. Consult [traversal and ignores](search/traversal-and-ignores.md) for precedence, global configuration, depth, filesystem boundaries, and pruning, and [metadata filters](search/metadata-filters.md) for type, size, time, and ownership constraints.

## Work with results

For a single command per match, use `-x`; for commands accepting a list of paths, use `-X`. Put the execution option last because subsequent arguments belong to the child command:

```sh
fd -t f -e rs . src -x echo '{}'
fd -t f -e rs . src -X wc -l
fd -t f -e rs --format '{//}: {/}'
fd --color=never --hyperlink=never -0 -t f -e rs | xargs -0 wc -l
```

The last example uses NUL-delimited output for Unix-style pipelines. Commands are passed an argument vector; shell syntax requires an explicitly invoked shell. Per-result execution is parallel by default; `-j 1` selects serial execution. Batch execution may split at a requested batch size or an OS argument-length limit. See [command execution](workflows/command-execution.md) for templates, repeated commands, stdio and failure behavior.

Path output is opportunistically sorted only when a search completes within its initial buffering budget; longer searches stream. Terminal output escapes unsafe filename characters. Uncolored, unformatted Unix pipe output without a custom separator preserves native path bytes. See [output and formatting](output/rendering-and-formatting.md) for exact conditions, color, links, and template behavior.

Ordinary searches can succeed with zero matches. Use `fd --quiet pattern` when a script needs status 0 for at least one match and status 1 for no match. Setup and command failures also use status 1, so that code is not uniquely a no-match signal. Optional traversal-error diagnostics do not themselves change a normal search's success status.

## Find the right explanation

| Task or question | Read next | Source starting point |
| --- | --- | --- |
| Follow options through the runtime, concurrency, and cancellation | [Search pipeline](architecture/search-pipeline.md) | `src/main.rs`, `src/config.rs`, `src/walk.rs`, `src/exit_codes.rs` |
| Change regex/glob/literal behavior, case, roots, or path checks | [Patterns and paths](search/patterns-and-paths.md) | `src/cli.rs`, `src/regex_helper.rs`, `src/filesystem.rs` |
| Diagnose missing files or change descent rules | [Traversal and ignores](search/traversal-and-ignores.md) | `WorkerState::build_walker`, worker callback in `src/walk.rs` |
| Add or debug a metadata predicate | [Metadata filters](search/metadata-filters.md) | `src/filter/`, `src/filetypes.rs`, `src/dir_entry.rs` |
| Process matches with external tools | [Command execution](workflows/command-execution.md) | `src/exec/`, `cli::Exec` |
| Change printing, encoding, templates, colors, or links | [Output and formatting](output/rendering-and-formatting.md) | `src/output.rs`, `src/fmt/`, `src/sanitize.rs`, `src/hyperlink.rs` |
| Select tests, maintain completions, or prepare artifacts | [Development workflow](development/build-test-release.md) | `tests/tests.rs`, `tests/testenv/mod.rs`, `Makefile`, `CICD.yml` |

For a focused smoke check of matching or traversal, run `cargo test --locked --test tests test_simple` or select the relevant named regression from the subsystem page. The integration harness executes the built binary in a temporary filesystem and normally normalizes output order, so use direct output inspection when testing ordering or raw bytes. The root README and `doc/fd.1` remain the broader user reference; this wiki connects behavior to its implementation and tests.
