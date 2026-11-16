---
type: architecture
title: System Overview
description: Map of the fd binary's architecture - entry point, module layout under src/, the pipeline from argument parsing to printed or executed results, the concurrency model and the exit-status contract.
tags: [architecture, overview, modules, concurrency, exit-codes, rust]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:10:54.611Z
sources:
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T18:10:54.611Z" }
---

# System Overview

`fd` (crate `fd-find`, edition 2024, MSRV 1.90.0) is a single-binary
command-line tool. It has no library target and no daemon: each invocation
parses arguments, walks one or more directory trees in parallel, filters the
entries, and either prints them or runs a command for each (or each batch of)
match. This page gives the big picture; the other architecture pages go deeper.

## Entry point and program phases

`src/main.rs` declares every module (`cli`, `config`, `dir_entry`, `error`,
`exec`, `exit_codes`, `filesystem`, `filetypes`, `filter`, `fmt`,
`hyperlink`, `output`, `regex_helper`, `sanitize`, `walk`) and defines
`main()`, which delegates to `run()` and maps its result to a process exit.
A jemalloc global allocator is installed on the platforms where it is
enabled; the choice is gated by `cfg` attributes that must stay in sync with
`Cargo.toml`.

A run moves through four phases:

1. **Configuration.** `cli::Opts` (clap) is parsed, search roots are resolved,
   patterns are translated to regex sources, and `main.rs::construct_config`
   produces a `config::Config`. See
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md).
2. **Traversal and filtering.** `walk::scan` builds an `ignore::WalkParallel`
   and runs sender threads that test each entry against name patterns,
   extensions, file types, owner, size and time filters. See
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   [Parallel Directory Traversal](/openwiki/architecture/parallel-traversal.md)
<!-- openwiki: broken internal link [/openwiki/architecture/search-filters.md] link "/openwiki/architecture/search-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   and [Search Filters and Ignore Rules](/openwiki/architecture/search-filters.md).
3. **Delivery.** A single receiver thread either prints matches
<!-- openwiki: broken internal link [/openwiki/workflows/output-formatting.md] link "/openwiki/workflows/output-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   (`output.rs`, see [Output Formatting](/openwiki/workflows/output-formatting.md))
   or feeds them to job threads (`exec/`, see
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   [Command Execution](/openwiki/workflows/command-execution.md)).
4. **Exit.** The receiver's result is converted to an `ExitCode` and the process
   exits.

## Module responsibilities

| Module | Role |
| --- | --- |
| `cli.rs` | clap `Opts`, defaults, path normalization, thread count, completion flag |
| `config.rs` | `Config`, the immutable run configuration handed to the walker |
| `walk.rs` | parallel walk, filtering, batching, receiver buffering, quit and Ctrl-C |
| `dir_entry.rs` | `DirEntry` wrapper with lazily cached metadata and LS_COLORS style |
| `filter/`, `filetypes.rs` | size, time, owner and file-type predicates |
| `output.rs`, `sanitize.rs`, `hyperlink.rs` | printing, colors, terminal-safe text, OSC 8 links |
| `exec/` | `--exec` and `--exec-batch` command sets, job and batch runners |
| `fmt/` | placeholder templates used by `--format` and `--exec` |
| `regex_helper.rs` | regex introspection (uppercase literal, leading-dot detection) |
| `filesystem.rs` | absolute paths, directory and device checks, path separators |
| `error.rs`, `exit_codes.rs` | error printing and the exit status type |

Only `walk.rs` and `exec/` create threads. Everything else is pure per-entry
logic or single-threaded I/O.

## Concurrency model

The walk is parallel: `Config::threads` (default: available parallelism, at
most 64) sets the walker's thread count. Each sender thread filters entries and
pushes them into a `Batch` (up to 256 entries, or 1 when parallel `--exec` is
in use so work spreads across receivers). Batches travel over a bounded
crossbeam channel of capacity `2 * threads`, which provides backpressure.

The receiver is one thread. It starts in *buffering* mode, holding results for
up to `--max-buffer-time` (default 100 ms) or 1000 entries so that quick
searches print sorted-looking output; after that it switches to *streaming*
mode and prints each batch as it arrives. Output for `--exec` is handled
separately by job threads (`exec/job.rs`).

Shared state between senders and the receiver is limited to two atomic flags
in `WorkerState`: `quit_flag` (stop walking) and `interrupt_flag` (Ctrl-C). A
Ctrl-C sets both; a second Ctrl-C exits immediately. The handler is installed
only when results are printed and colors are enabled
(`config.ls_colors.is_some() && config.is_printing()`); in other modes the
default SIGINT behavior applies. Details are in the traversal page.

## Exit-status contract

`exit_codes::ExitCode` has four variants with fixed integer values:

| Variant | Code | When |
| --- | --- | --- |
| `Success` | 0 | Command succeeded, or the search found at least one entry |
| `HasResults(false)` | 1 | Search completed with no matches |
| `GeneralError` | 1 | Error reported during configuration or command execution |
| `KilledBySigint` | 130 | Interrupted by Ctrl-C; the process re-raises SIGINT on Unix |

`HasResults(has_results)` is produced by the receiver: it is `HasResults(true)`
immediately when `--quiet` sees its first match, and otherwise
`HasResults(num_results > 0)` at the end of the walk. Filesystem errors during
the walk are reported on stderr but do not change the exit code, because they
are reported as `WorkerResult::Error` and skipped. Errors from `--exec` jobs are
merged with `merge_exitcodes`, which yields `GeneralError` if any job failed.

## Error reporting

`error::print_error` writes `[fd error]: <message>` to stderr. When stderr is a
terminal, the message is passed through `sanitize::maybe_sanitize` so that
control characters in file names cannot inject escape sequences. Fatal startup
errors are returned as `anyhow::Error` from `run()` and printed by `main()`.

## Where to start reading

- Changing a flag or its default: `src/cli.rs`, then `construct_config` in
  `src/main.rs`.
- Changing what matches: `src/walk.rs` (sender closure) and `src/filter/`.
- Changing output: `src/output.rs` and `src/fmt/`.
- Changing `--exec`: `src/exec/mod.rs` and `src/exec/job.rs`.

<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
See the [Quickstart](/openwiki/quickstart.md) for build and test commands.
