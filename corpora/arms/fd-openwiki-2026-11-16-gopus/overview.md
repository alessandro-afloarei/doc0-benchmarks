---
type: overview
title: System Overview
description: What fd is and how its single Rust binary is organized — module responsibilities, the key third-party crates it builds on, and how argument parsing, configuration, parallel traversal, filtering, output, and command execution fit together.
tags: [overview, architecture, modules, dependencies]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-47d76f6cde81cde2b78e68be
    resource: repo://src/exec/mod.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# System Overview

fd (`fd-find` on crates.io) is a command-line program for finding filesystem
entries — a simpler, faster, opinionated alternative to `find`. Its defaults:
regex patterns matched against file names, smart case, skipping hidden entries,
honoring `.gitignore`, colored output, and parallel traversal. It is a single
binary crate with no library target; all modules are declared in `src/main.rs`.

## Data flow at a glance

```
argv ─► cli::Opts (clap) ─► main::construct_config ─► config::Config ─┐
                     └─► pattern strings ─► regex::bytes::Regex ──────┤
                                                                      ▼
                                                    walk::scan (ignore::WalkParallel)
                                                      │ sender threads: match + filter
                                                      ▼
                                            bounded channel of batches
                                                      │
                     ┌────────────────────────────────┼─────────────────────────┐
                     ▼                                ▼                         ▼
            output::print_entry               exec::job (× threads)        exec::batch
            (colors, format, sanitize)        (--exec)                     (--exec-batch, -l)
                                                      │
                                                      ▼
                                              exit_codes::ExitCode
```

## Modules

| Module | Responsibility |
| --- | --- |
| `main.rs` | Entry point, `run()` pipeline, pattern translation, `construct_config`, `--list-details` ls selection, diagnostics, jemalloc allocator, default LS_COLORS. |
| `cli.rs` | clap derive `Opts`, hand-rolled `Exec` args, search-path resolution, derived option helpers. |
| `config.rs` | Immutable `Config` shared by all threads. |
| `walk.rs` | Walker construction, sender filter chain, batching, receiver buffering/streaming, Ctrl-C handling. |
| `dir_entry.rs` | `DirEntry` wrapper (normal or broken symlink) with cached metadata and color style; path stripping; sort order. |
| `filter/` | `SizeFilter`, `TimeFilter`, Unix `OwnerFilter`. |
| `filetypes.rs` | `FileTypes` for `--type`. |
| `regex_helper.rs` | Smart-case and leading-dot analysis using `regex-syntax`. |
| `exec/` | `CommandSet`/`CommandTemplate`, job loops, command spawning and output buffering. |
| `fmt/` | `FormatTemplate` placeholder engine for `--format` and exec arguments. |
| `output.rs` | Printing results (format, colorized, uncolorized/raw bytes). |
| `hyperlink.rs` | OSC 8 `file://` URLs. |
| `sanitize.rs` | Escaping control/invisible characters for terminal output. |
| `filesystem.rs` | Path helpers, file-type predicates, platform shims. |
| `exit_codes.rs`, `error.rs` | Exit-code model and `[fd error]` printing. |

## Key dependencies

- **`ignore`** (from ripgrep) — parallel directory walking and all
  gitignore/hidden/override logic.
- **`regex`, `regex-syntax`, `globset`, `aho-corasick`** — pattern matching,
  pattern analysis, glob translation, and placeholder parsing.
- **`clap`** (+ `clap_complete`) — argument parsing and shell completions.
- **`crossbeam-channel`** — bounded channel between walker and receiver.
- **`lscolors`, `nu-ansi-term`** — LS_COLORS styling.
- **`argmax`** — command construction that respects OS argument-length limits.
- **`jiff`** — time/duration parsing; **`etcetera`** — config directory for the
  global ignore file; **`faccess`** — executable checks; **`normpath`** — path
  normalization; **`ctrlc`** — interrupt handling; **`nix`** (Unix) — signals,
  users/groups, hostname; **`anyhow`** — error handling.

## Where to go next

- Control flow: [Search Pipeline](architecture/search-pipeline.md) and
  [Parallel Walk, Batching, and the Receiver](architecture/parallel-walk-and-receiver.md).
- Concepts: [Pattern Matching](concepts/pattern-matching.md),
  [Ignore Rules](concepts/ignore-rules-and-hidden-files.md),
  [Entry Filters](concepts/entry-filters.md).
- Features: [Output Formatting](features/output-formatting.md),
  [Command Execution](features/command-execution.md).
- Reference: [CLI Options](reference/cli-options.md),
  [Exit Codes and Errors](reference/exit-codes-and-errors.md).
- Operations and testing: [Build, CI, Release](operations/build-release-and-packaging.md),
  [Test Suite](testing/test-suite.md).
