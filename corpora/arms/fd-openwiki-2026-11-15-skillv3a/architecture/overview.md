---
type: architecture
title: Architecture Overview
description: End-to-end runtime pipeline of the fd binary — from argument parsing and Config construction through the parallel ignore-crate walk and per-entry filtering to the printing receiver or the --exec command runner — plus a map of module responsibilities.
tags: [architecture, pipeline, modules, overview]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# Architecture Overview

fd (crate `fd-find`, binary `fd`) is a single Rust binary with no library target. Everything is wired together in `src/main.rs`, and the actual search lives in `src/walk.rs`. The design is a classic **producer/consumer pipeline**: many walker threads discover and filter entries in parallel and send them over a bounded channel to a single consumer that either prints them or runs commands.

## Pipeline at a glance

```text
 argv ──► Opts (clap, src/cli.rs)
            │
            ▼
   run() in src/main.rs
     ├─ --gen-completions? → print & exit
     ├─ set_working_dir (--base-directory)
     ├─ search_paths(), pattern-is-a-path check
     ├─ build_pattern_regex() per pattern (glob / exact / fixed / regex)
     ├─ construct_config() ──► Config (src/config.rs)
     ├─ leading-dot / hidden warning
     └─ build_regex() → Vec<regex::bytes::Regex>
            │
            ▼
   walk::scan(paths, regexps, config)
     ├─ build ignore::WalkParallel (ignore rules, overrides, depth, threads)
     ├─ sender closures (one per walker thread)
     │     depth/min-depth → name regexes → extension → type → owner
     │     → size → mtime → precompute color → BatchSender
     └─ receiver (bounded crossbeam channel)
           ├─ no command:  ReceiverBuffer → output::print_entry → stdout
           ├─ --exec:      N threads of exec::job (one command per entry)
           └─ --exec-batch / --list-details: exec::batch (argmax-limited batches)
            │
            ▼
   ExitCode → process::exit (SIGINT re-raised on Unix)
```

## Module responsibilities

| Module | Responsibility | Wiki page |
|--------|----------------|-----------|
| `main.rs` | Entry point, pattern → regex conversion, `construct_config`, `--list-details` command synthesis, jemalloc allocator selection | [CLI and Configuration](cli-and-configuration.md), [Pattern Matching](../concepts/pattern-matching.md) |
| `cli.rs` | clap `Opts` definition, derived option helpers, hand-written `--exec` arg parsing | [CLI and Configuration](cli-and-configuration.md) |
| `config.rs` | Immutable resolved `Config` shared by all threads | [CLI and Configuration](cli-and-configuration.md) |
| `walk.rs` | Builds the parallel walker, filters entries, batching, buffering/streaming receiver, Ctrl-C handling | [Parallel Walk and Receiver](parallel-walk-and-receiver.md) |
| `dir_entry.rs` | `DirEntry` wrapper (normal or broken symlink) with lazily cached metadata and color style | [Parallel Walk and Receiver](parallel-walk-and-receiver.md) |
| `filetypes.rs`, `filter/` | Type, size, time, owner filters | [Entry Filters](../concepts/entry-filters.md) |
| `regex_helper.rs` | Regex AST inspection (uppercase detection, leading-dot detection) | [Pattern Matching](../concepts/pattern-matching.md) |
| `output.rs`, `fmt/`, `hyperlink.rs`, `sanitize.rs` | Printing, `--format` templates, OSC 8 hyperlinks, escape sanitization | [Output Formatting](../features/output-formatting.md) |
| `exec/` | `--exec` / `--exec-batch` command templates and execution | [Command Execution](../features/command-execution.md) |
| `exit_codes.rs`, `error.rs` | Exit code mapping/merging, error printing | [Exit Codes and Errors](../operations/exit-codes-and-errors.md) |
| `filesystem.rs` | Platform helpers: absolute paths, existence checks, file-type predicates, `OsStr`→bytes, default path separator | — |

## Key design decisions

### Matching on bytes, filtering cheapest-first

Patterns are compiled to `regex::bytes::Regex` and matched against the raw bytes of the file name (or the absolute path with `--full-path`), so non-UTF-8 names are handled on Unix. Inside each walker callback the name check runs before any filter that needs `stat` metadata, keeping the common case syscall-free.

### Delegating traversal and ignore semantics to `ignore`

fd does not implement directory recursion or gitignore parsing itself. It configures `ignore::WalkBuilder` (the same crate used by ripgrep) and translates fd options into builder calls. See [Ignore Rules and Hidden Files](../concepts/ignore-rules-and-hidden-files.md).

### Sorted output when fast, streaming when slow

The printing receiver buffers results for up to 100 ms (or 1000 entries). If the search finishes inside that window the output is sorted by path; otherwise it switches to streaming in arrival order. Thus small searches have deterministic output while large searches start printing promptly.

### Commands replace printing

When a `CommandSet` is present, `Config::is_printing()` is false and the receiver is replaced by exec worker threads. Combining `--exec` with `--max-results`/`--quiet` is rejected by clap.

### Allocator

On most non-Windows/non-macOS targets the `use-jemalloc` feature installs `tikv_jemallocator` as the global allocator for performance. The `cfg` list in `main.rs` must stay in sync with the target-specific dependency in `Cargo.toml`. See [Build, Release, and Packaging](../operations/build-release-and-packaging.md).

## Error handling model

`run()` returns `anyhow::Result<ExitCode>`. Setup errors (bad regex, invalid directory, malformed time) are printed as `[fd error]: ...` and exit with code 1. Errors encountered during traversal are sent as `WorkerResult::Error` and only printed with `--show-errors`. See [Exit Codes, Errors, and Interrupts](../operations/exit-codes-and-errors.md).
