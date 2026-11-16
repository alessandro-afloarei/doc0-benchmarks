---
type: architecture
title: Architecture Overview
description: End-to-end map of fd, from argument parsing through config construction, regex compilation, parallel directory traversal, per-entry filtering, and result delivery to printing or command execution, with the owning module for each stage.
tags: [architecture, pipeline, modules, threads, overview]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Architecture Overview

`fd` is a single Rust binary (`fd-find` on crates.io, built from `src/main.rs`) that walks
one or more directory trees in parallel, keeps entries whose names match every supplied
pattern, and prints them or runs a command for each. The program has no long-lived state:
each invocation parses arguments, builds one `Config`, walks the filesystem once, and exits.
This page describes the stages in order and names the module that owns each one. Detailed
behavior is covered by the linked pages.

## Pipeline at a glance

```
argv
  └─ cli::Opts (clap)                      src/cli.rs
       └─ main::run                         src/main.rs
            ├─ search roots, pattern validation
            ├─ regex sources  ──► regex::bytes::Regex list
            └─ config::Config                src/config.rs
                 └─ walk::scan               src/walk.rs
                      ├─ ignore::WalkParallel  (worker threads)
                      │    per entry: patterns → extension → type → owner → size → time → send
                      ├─ crossbeam channel of Batch
                      └─ receiver
                           ├─ output::print_entry   (stdout)
                           └─ exec::job / exec::batch (--exec, --exec-batch, -l)
```

## Stages and owners

| Stage | Owner | Notes |
| --- | --- | --- |
| Argument parsing | `src/cli.rs` (`Opts`) | clap derive; also derived helpers such as `threads()` and `max_depth()`. |
| Orchestration and validation | `src/main.rs` (`run`) | Path-like pattern guard, leading-dot guard, regex compilation, and final dispatch to `walk::scan`. |
| Resolved settings | `src/config.rs` (`Config`) | Built once by `construct_config`; passed by value into the walker. |
| Traversal and filtering | `src/walk.rs` (`WorkerState`) | Builds the `ignore` walker, applies per-entry filters on worker threads, and batches results. |
| Entry model | `src/dir_entry.rs` (`DirEntry`) | Wraps paths and cached metadata and implements ordering and styling. |
| Filters | `src/filetypes.rs`, `src/filter/*` | File type, size, time, and owner predicates. |
| Printing | `src/output.rs`, `src/fmt/`, `src/sanitize.rs`, `src/hyperlink.rs` | Default printing, `--format` templates, terminal escaping, and OSC 8 hyperlinks. |
| Command execution | `src/exec/` | `--exec` and `--exec-batch` command templates, job and batch runners, output buffering. |
| Exit codes and messages | `src/exit_codes.rs`, `src/error.rs` | Maps outcomes to process exit codes and writes errors to stderr. |
| Platform helpers | `src/filesystem.rs`, `src/hyperlink.rs` | Device and socket checks, absolute paths, default separators, host names for hyperlinks. |

## Control flow

1. `main` calls `run`, which parses `Opts` and resolves the search roots. Each root must be
   an existing directory.
2. `run` compiles every pattern and builds `Config`. Patterns are checked before any
   filesystem traversal begins.
3. `walk::scan` creates a `WorkerState` that owns the patterns, the `Config`, and two
   shared flags: a quit flag and an interrupt flag.
4. When results are printed with colors enabled, `scan` installs a Ctrl-C handler that sets
   the quit flag; a second Ctrl-C exits immediately. `scan` then starts a receiver thread
   and the parallel senders. The receiver consumes batches from a channel bounded at twice
   the thread count until the senders finish.
5. Each worker thread visits entries through `ignore::WalkParallel`. An entry is dropped as
   soon as any predicate fails; survivors are wrapped as `WorkerResult::Entry` and sent to
   the receiver.
6. The receiver either prints each entry (default) or dispatches it to the execution
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   layer. Printing is covered in [Parallel Traversal](/openwiki/architecture/parallel-traversal.md)
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   and the command path in [Command Execution](/openwiki/workflows/command-execution.md).
7. When `scan` returns, the exit code is `KilledBySigint` if the interrupt flag was set,
   otherwise the merged result of the receiver or command execution.

## Key design decisions

- **Filter before send.** Predicates run on worker threads so that discarded entries never
  cross the channel. Only matched entries reach the single receiver thread.
- **One configuration object.** Flags are translated into `Config` once. Downstream code
  never re-reads `Opts`, which keeps the walker testable through `Config` and regexes.
- **Patterns are regexes.** Glob, exact, and fixed-string modes are all translated to
  regex source before compilation, so every match runs through the same `regex` engine
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  (see [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)).
- **Errors do not abort traversal.** Filesystem errors inside the walk become
  `WorkerResult::Error` values; they are printed only when `--show-errors` is set, and the
  walk continues.

## Where to look next

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Starting a change to flags or defaults: [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md).
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Changing how results are ordered, buffered, or stopped: [Parallel Traversal](/openwiki/architecture/parallel-traversal.md).
<!-- openwiki: broken internal link [/openwiki/workflows/filtering-entries.md] link "/openwiki/workflows/filtering-entries.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Adding a per-entry filter: [Filtering Entries](/openwiki/workflows/filtering-entries.md).
<!-- openwiki: broken internal link [/openwiki/workflows/output-and-formatting.md] link "/openwiki/workflows/output-and-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Changing printed output: [Output and Formatting](/openwiki/workflows/output-and-formatting.md).
<!-- openwiki: broken internal link [/openwiki/concepts/exit-codes-and-errors.md] link "/openwiki/concepts/exit-codes-and-errors.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Exit status and error handling: [Exit Codes and Error Reporting](/openwiki/concepts/exit-codes-and-errors.md).
