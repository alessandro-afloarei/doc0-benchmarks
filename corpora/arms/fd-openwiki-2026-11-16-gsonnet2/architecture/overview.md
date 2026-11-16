---
type: architecture
title: Architecture Overview and Search Lifecycle
description: End-to-end description of one fd invocation - from clap parsing and pattern compilation in main.rs through the parallel directory walk and receiver to exit codes - plus a module map and cross-cutting invariants.
tags: [architecture, lifecycle, rust, modules, exit-codes]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
sources:
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# Architecture Overview and Search Lifecycle

`fd` (crate `fd-find`, binary `fd`) is a single-binary Rust CLI that finds filesystem entries by matching a pattern against names (or full paths) during a parallel directory walk. There is no persistent state, daemon or network I/O: one invocation is one pass.

## Lifecycle of one invocation

`src/main.rs::run` is the whole control flow:

1. **Parse** `Opts` with clap (see [[architecture/cli-and-config]]). With the optional `completions` feature, `--gen-completions` prints shell completions and returns early.
2. **Set working dir** if `--base-directory` is given, then resolve **search paths**; an empty result is an error.
3. **Guard against path-as-pattern**: a `/` in a pattern without `--full-path` is rejected with a hint (see [[architecture/pattern-matching]]).
4. **Compile patterns**: each pattern (positional plus every `--and`) becomes a regex string (glob, exact, fixed-string or raw regex).
5. **Build `Config`** (`construct_config`), which decides smart case, ignore policy, colors, filters and command mode.
6. **Check the leading-dot guard**, then compile `regex::bytes::Regex` objects (case-insensitive unless the config says sensitive, `.` matches newlines).
7. **Scan**: `walk::scan(&search_paths, regexps, config)` returns an `ExitCode`.

`main` maps `Ok(code)` to `code.exit()` and `Err(e)` to `[fd error]: ...` on stderr plus exit code 1.

## The scan: sender threads and one receiver

`walk::scan` creates a `WorkerState` and runs a **bounded** crossbeam channel (capacity `2 × threads`). Inside a `thread::scope`:

- a **receiver** thread (or `threads` command-runner threads for `--exec`) consumes batches;
- the calling thread runs the `ignore` crate's `WalkParallel`, whose per-thread closures are the **senders**: each applies name matching and all filters, then pushes surviving `DirEntry`s as batches.

The receiver either prints results (buffering up to 100 ms or 1000 entries to emit sorted output for fast searches, then streaming) or executes commands. Details are in [[architecture/parallel-walk-pipeline]] and [[architecture/command-execution]].

## Module map

| Module | Role |
| --- | --- |
| `cli.rs` | clap `Opts`, hand-rolled `--exec` parsing, search-path normalization |
| `config.rs` | immutable `Config` shared by all threads |
| `main.rs` | orchestration, pattern compilation, `Config` construction, LS_COLORS default |
| `walk.rs` | walker construction, per-entry filtering, batching, receiver and Ctrl-C handling |
| `dir_entry.rs`, `filesystem.rs`, `filetypes.rs` | entry abstraction (incl. broken symlinks), path helpers, type filtering |
| `filter/` | size, time and (Unix) owner filters — see [[concepts/entry-filters]] |
| `regex_helper.rs` | smart-case and leading-dot detection through regex HIR |
| `exec/`, `fmt/` | command execution and placeholder templates |
| `output.rs`, `sanitize.rs`, `hyperlink.rs`, `error.rs` | rendering and terminal safety — see [[architecture/output-and-terminal-safety]] |
| `exit_codes.rs` | `ExitCode` enum and merging |

## Exit codes

`ExitCode` has four variants: `Success` (0), `HasResults(bool)` (0 if there was a match, 1 otherwise — used by `--quiet`), `GeneralError` (1) and `KilledBySigint` (130). On Unix, `KilledBySigint` resets the SIGINT handler to default and re-raises the signal so the shell sees a genuine signal death. Merging results from several command jobs yields `GeneralError` if any failed.

## Cross-cutting invariants

- **Config is read-only after construction.** Everything the sender threads need (patterns, filters, ignore policy) is in `Config`/`WorkerState`, shared by reference with no locks.
- **Matching works on bytes.** Names are converted with `osstr_to_bytes` and matched using `regex::bytes`, so non-UTF-8 file names work on Unix.
- **Cheapest check first.** Name matching precedes extension/type/owner/size/time checks, and metadata is loaded lazily and only when a filter needs it.
- **Output is deterministic only for short searches.** Sorting happens solely while the receiver is still in its initial buffering window.
- **Terminal safety.** Anything derived from file names is sanitized when stdout/stderr is a terminal.
- **Allocator.** On supported targets with the `use-jemalloc` feature, `tikv-jemallocator` is the global allocator (see [[operations/build-release]]).

## Where to go next

- Flag handling and Config: [[architecture/cli-and-config]]
- Pattern semantics: [[architecture/pattern-matching]]
- Traversal rules: [[concepts/ignore-rules-and-hidden-files]]
- Tests: [[operations/testing]]
