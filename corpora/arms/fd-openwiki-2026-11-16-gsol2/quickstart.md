---
type: guide
title: Quickstart and task guide
description: Build and use this fd repository, understand its search defaults, and find the right architecture, concept, workflow, or operations page for a task.
tags: [quickstart, navigation, search, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:27.513Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
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
generated: { by: "codex", at: "2026-11-16T16:28:27.513Z" }
---

# Quickstart and task guide

This repository implements `fd`, a command-line program for finding filesystem entries. Cargo calls the package `fd-find` and builds the executable `fd`. It searches recursively, matches regular expressions against filenames by default, and filters hidden and ignored paths unless requested otherwise.

## Build and try it

The manifest requires Rust 1.90.0 or later and edition 2024. From the repository root:

```bash
cargo build --locked
cargo run --locked -- --help
cargo run --locked -- -e rs src
cargo test --locked
```

After building, run `target/debug/fd` directly on Unix-like hosts, or the corresponding `.exe` on Windows. For an optimized binary use `cargo build --locked --release`; for a local Cargo installation use `cargo install --locked --path .`. The Makefile supplies completion/man-page staging in addition to the binary; see [build and release](operations/build-and-release.md).

## Common searches

The command shape is `fd [OPTIONS] [pattern] [path]...`. The pattern comes before positional roots. Use a match-all pattern when naming roots without a restrictive name query.

| Task | Example |
| --- | --- |
| List visible, nonignored entries below the working directory | `fd` |
| Search filenames below selected roots | `fd test src tests` |
| List entries below one directory | `fd . src` |
| Find Rust files | `fd -t f -e rs` |
| Use a glob | `fd -g '*.rs' src` |
| Match a literal filename exactly | `fd --exact main.rs src` |
| Require two patterns on the same name | `fd test --and '\.rs$'` |
| Match parent directories as well as names | `fd --full-path 'src/.*\.rs$'` |
| Include hidden and automatically ignored paths | `fd -u` |
| Test whether a match exists without printing | `fd -q --exact Cargo.toml` |
| Pass NUL-separated paths downstream | `fd -t f -0` |
| Run a command once per result | `fd -e rs src -x wc -l` |
| Pass results as arguments to batch commands | `fd -e rs src -X wc -l` |

Shell-quote patterns and placeholders containing metacharacters. A pattern beginning with `-` can follow `--`, as in `fd -- '-foo'`. Use `fd -h` for concise help and `fd --help` for detailed explanations.

## Defaults that affect results

Patterns are regexes and may match substrings. Lowercase patterns normally match without case sensitivity; an uppercase literal or class can enable smart case for the whole pattern set. `--ignore-case` and `--case-sensitive` provide explicit control. `--fixed-strings` searches literal substrings; `--exact` requires a complete literal name/path match.

Hidden inclusion (`-H`) and ignoring rules (`-I`) are separate. `-u` combines them. `.ignore`, `.fdignore`, Git rules, parent rules, and the fd global ignore file can influence discovery; explicit exclusions and ignore files are separate controls. If a result is missing, follow the [traversal troubleshooting procedure](concepts/traversal-and-ignore.md#diagnosing-a-missing-result) before changing the pattern.

Full-path matching and absolute output are different choices. Quiet mode exits zero if a result exists and one otherwise; an ordinary successful search can return zero with no matches. Small, quickly completed searches are sorted while still buffered; long searches stream in discovery order. Do not rely on a universal output ordering guarantee.

Execution options consume the following arguments as the command template. Place them last or terminate templates with a shell-escaped semicolon. Per-result commands can run concurrently; batch commands can split at operating-system argument limits or `--batch-size`. fd starts processes directly, so aliases and shell syntax require an explicitly invoked shell or an executable wrapper.

## Find the right page

| Reader task | Start here |
| --- | --- |
| Understand option-to-result flow, ownership, channels, shutdown, and exit codes | [Search pipeline and concurrency](architecture/search-pipeline.md) |
| Change regex/glob/literal matching, smart case, or metadata constraints | [Matching and metadata filters](concepts/matching-and-filters.md) |
| Diagnose missing entries or change roots, ignore rules, depth, links, and pruning | [Traversal scope and ignore rules](concepts/traversal-and-ignore.md) |
| Change colors, terminal sanitation, hyperlinks, raw path output, or placeholders | [Output, formatting, and path representation](concepts/output-and-paths.md) |
| Understand `-x`, `-X`, child output, argument limits, or detailed listing | [Executing commands over search results](workflows/command-execution.md) |
| Add a regression test, understand fixtures, or select CI-equivalent checks | [Development and testing](workflows/development-and-testing.md) |
| Install completion/man assets, add a build target, or prepare a release | [Build, installation, and release maintenance](operations/build-and-release.md) |

## Source landmarks

`src/cli.rs` defines public flags and help. `src/main.rs` validates inputs and constructs `Config`. `src/walk.rs` connects the parallel walker to fd's filters and consumers. `src/filter` and `src/filetypes.rs` implement metadata predicates. `src/output.rs`, `src/fmt`, `src/sanitize.rs`, and `src/hyperlink.rs` own rendering and template behavior. `src/exec` handles child commands. `tests/tests.rs` uses the temporary-filesystem harness in `tests/testenv/mod.rs`.

For user-facing option details, consult the checked-in README and `doc/fd.1` alongside current CLI help. For contributions and release policy, use `CONTRIBUTING.md` and `doc/release-checklist.md`. Source and tests remain authoritative when validating a change.
