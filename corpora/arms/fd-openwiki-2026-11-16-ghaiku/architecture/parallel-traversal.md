---
type: architecture
title: Parallel Traversal and Result Delivery
description: How fd drives the ignore crate's parallel walker, wires ignore and exclude rules into it, runs per-entry filtering on sender threads, batches results over a bounded channel, and switches the single receiver between buffered (sorted) and streaming output, including quit and interrupt handling.
tags: [walker, threads, ignore, channel, buffering, streaming, shutdown]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Parallel Traversal and Result Delivery

This page covers the middle of the pipeline in `src/walk.rs`: how directories are walked,
how results cross from worker threads to a receiver, and how the process stops. The
traversal itself is delegated to the `ignore` crate's `WalkParallel`. fd's code decides
which rules feed that walker, which entries survive, and how the survivors are delivered.
<!-- openwiki: broken internal link [/openwiki/workflows/filtering-entries.md] link "/openwiki/workflows/filtering-entries.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Filter predicates are described in [Filtering Entries](/openwiki/workflows/filtering-entries.md);
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
the overall pipeline is in [Architecture Overview](/openwiki/architecture/overview.md).

## Walker construction

`WorkerState::build_walker` creates a `WalkBuilder` rooted at the first search path. It
sets these options from `Config`:

- hidden-file filtering (`hidden`), `.fdignore` reading (`ignore`, plus the custom filename
  `.fdignore`), and parent-directory ignore files (`parents`, enabled only when some ignore
  source is active);
- VCS ignore handling (`git_ignore`, `git_global`, `git_exclude`) and whether a `.git`
  directory is required first (`require_git`);
- symlink following, same-filesystem restriction, and maximum depth;
- the thread count, passed to `build_parallel` as `config.threads`.

Additional inputs are attached to the same builder:

- the global ignore file at `<config dir>/fd/ignore`, when it exists and global ignore
  is enabled;
- each `--ignore-file` path;
- every search path after the first, via `builder.add`, so multiple roots share one walk.

Malformed patterns in global or custom ignore files are reported with `print_error`.
Partial parse errors are ignored silently.

### Exclude patterns

`build_overrides` creates an `OverrideBuilder` rooted at the first path. Each `--exclude`
value was already prefixed with `!` in `construct_config`, which makes the `ignore` crate
treat it as an exclusion. A malformed exclude pattern aborts the walk with
"Malformed exclude pattern".

## Sender threads

`spawn_senders` calls `walker.run` with a closure factory: each worker thread gets its own
`BatchSender` and a clone of the channel sender. Per entry, the worker:

1. Returns `WalkState::Quit` immediately if the quit flag is set.
2. For directories, skips the whole subtree when any `--ignore-contain` name exists inside
   it (`WalkState::Skip`).
3. Skips the root entry at depth 0.
4. Converts traversal errors. A `NotFound` error on a symlink becomes a broken-symlink
   entry rather than an error. Any other error is sent as `WorkerResult::Error`.
5. Applies the minimum-depth check, the pattern match, and the remaining filters, in the
<!-- openwiki: broken internal link [/openwiki/workflows/filtering-entries.md] link "/openwiki/workflows/filtering-entries.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   order described in [Filtering Entries](/openwiki/workflows/filtering-entries.md).
6. Sends the surviving `WorkerResult::Entry`. If the send fails because the receiver is
   gone, the worker returns `WalkState::Quit`.
7. Returns `WalkState::Skip` instead of `Continue` when `--prune` is set, so matched
   directories are not descended into.

## Batched channel

Results are not sent one by one. `BatchSender` accumulates `WorkerResult` values into a
shared `Batch` (an `Arc<Mutex<Option<Vec<_>>>>`). A new batch is sent over the channel when
the first item is added to it. A full batch is replaced when it reaches its limit:

- limit `0x100` (256) by default;
- limit `1` when `--exec` runs one command per entry and more than one thread is in use,
  so that work is spread across job threads instead of one batch.

The channel itself is `crossbeam_channel::bounded(2 * threads)`. The bound provides back
pressure: senders block when the receiver falls behind.

## Receiver: buffering and streaming

When results are printed (no `--exec`), `ReceiverBuffer` runs on a single thread and
writes to a `BufWriter` over stdout. It has two modes:

- **Buffering.** Entries are collected in a vector. The receiver waits for batches only
  until a deadline, `max_buffer_time` (default 100 ms; the flag is hidden in help).
- **Streaming.** Entries are printed as they arrive. The receiver flushes stdout whenever
  the channel is empty, so output appears promptly.

The receiver leaves buffering mode in one of three ways: the deadline passes with no
batch (`RecvTimeoutError::Timeout`), the buffer grows past 1000 entries, or the channel
disconnects because the walk has finished. A timeout or overflow streams the buffer
unsorted; a disconnect sorts the buffer first. This is why short searches print in sorted
order, while long searches print in traversal order.

Entries are counted as they are handled. Two options end the loop early:

- `--max-results` (and `--max-one-result`) stops once the count is reached.
- `--quiet` returns on the first entry with `HasResults(true)`.

Traversal errors reaching the receiver are printed only with `--show-errors`.

### Output errors

A write error other than a broken pipe prints "Could not write to output" and exits with
`GeneralError`. A broken pipe on write is ignored, so piping into `head` does not print an
error. A failed flush of stdout ends the run with `GeneralError` and prints nothing.

## Quit and interrupt

Two shared `AtomicBool` flags live in `WorkerState`:

- The **quit flag** is set when the receiver finishes or fails. Senders check it before each
  entry and return `WalkState::Quit`, so the walk stops promptly.
- The **interrupt flag** is set by the Ctrl-C handler (only installed when printing with
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  colors, see [Architecture Overview](/openwiki/architecture/overview.md)). The receiver
  checks it after each printed entry, flushes, and returns `KilledBySigint`. A second
  Ctrl-C exits immediately.

`scan` returns `KilledBySigint` whenever the interrupt flag is set at the end, regardless
of the receiver's own result.

## Invariants and consequences

- In printing mode only the receiver thread writes entries to stdout, so entries from
  different walker threads are never interleaved.
- Buffered output is sorted by `DirEntry` ordering, but only for searches that finish within
  the buffer window. Developers changing ordering should keep both code paths in mind.
- Because filtering happens on senders, adding an expensive predicate slows the walk, not the
  receiver. Adding work to the receiver slows the whole pipeline once the channel fills.

## Tests

Unit tests in `src/walk.rs` cover `search_str_for_entry`, which chooses between file name
and full path for matching. Integration tests in `tests/tests.rs` exercise the walk through
the binary, including ignore-file behavior and multi-path searches. See
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Testing Strategy](/openwiki/testing/test-strategy.md).

## Related pages

<!-- openwiki: broken internal link [/openwiki/workflows/filtering-entries.md] link "/openwiki/workflows/filtering-entries.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Filtering Entries](/openwiki/workflows/filtering-entries.md)
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Command Execution](/openwiki/workflows/command-execution.md)
<!-- openwiki: broken internal link [/openwiki/workflows/output-and-formatting.md] link "/openwiki/workflows/output-and-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Output and Formatting](/openwiki/workflows/output-and-formatting.md)
