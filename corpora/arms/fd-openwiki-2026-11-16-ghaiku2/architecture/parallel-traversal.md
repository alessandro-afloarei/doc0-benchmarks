---
type: architecture
title: Parallel Directory Traversal and Result Delivery
description: How fd's walker in src/walk.rs runs a parallel directory walk, batches matching entries across a bounded channel to a single receiver thread, switches from buffered to streaming output, and handles quit, Ctrl-C, broken pipes and exit status.
tags: [walk, concurrency, channels, batching, receiver, ctrl-c, exit-status, rust]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:10:54.611Z
sources:
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T18:10:54.611Z" }
---

# Parallel Directory Traversal and Result Delivery

`src/walk.rs` is the engine of `fd`. It turns a `Config` and a list of
compiled patterns into a stream of matching `DirEntry` values, and delivers
that stream either to standard output or to the `--exec` machinery. The
filter predicates applied to each entry are described in
<!-- openwiki: broken internal link [/openwiki/architecture/search-filters.md] link "/openwiki/architecture/search-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Search Filters and Ignore Rules](/openwiki/architecture/search-filters.md);
this page covers the threading, batching and lifecycle around them.

## Entry point

`walk::scan(paths, patterns, config)` constructs a `WorkerState` and calls
`WorkerState::scan`. `WorkerState` holds the compiled regexes, the `Config`,
and two shared flags: `quit_flag` (ask all walkers to stop) and
`interrupt_flag` (a Ctrl-C was received). Both are `Arc<AtomicBool>` so that
the signal handler can set them.

`scan` does four things:

1. Builds the walker with `build_walker`, which calls `ignore::WalkBuilder`.
   Hidden-file, `.fdignore`, `.gitignore`, global-ignore, parent-ignore and
   git-requirement settings are passed through from `Config`. Custom ignore
   files from `--ignore-file` are added, and `--exclude` patterns become an
   `ignore::overrides::Override` rooted at the first search path. Additional
   search roots are added with `builder.add`. The walker is built with
   `build_parallel()` and `threads = config.threads`.
2. Installs the Ctrl-C handler when results are printed with colors enabled.
   The first signal sets `quit_flag`. A second signal (when `interrupt_flag`
   was already set) calls `ExitCode::KilledBySigint.exit()` immediately.
3. Creates a bounded channel with capacity `2 * threads` carrying `Batch`
   values.
4. Runs the receiver in a scoped thread and the senders on the calling thread
   pool via `spawn_senders`, then joins the receiver. If `interrupt_flag` was
   set, the result is `KilledBySigint`; otherwise it is the receiver's code.

## Sender threads

`spawn_senders` calls `WalkParallel::run` with a factory that creates one
closure per walker thread. Each closure owns a `BatchSender` and performs the
following per-entry steps in this order:

1. If `quit_flag` is set, return `WalkState::Quit`.
2. For directories, skip the subtree (`WalkState::Skip`) when any name in
   `ignore_contain` exists inside it. The file-type check comes first so the
   `exists()` syscall runs only for directories.
3. Skip the root entry (depth 0). Convert errors: a `NotFound` error on a
   symlink becomes a broken-symlink `DirEntry`; any other error is forwarded
   as `WorkerResult::Error`.
4. Apply `min_depth`.
5. Match the search string. Without `--full-path` this is the file name;
   with `--full-path` it is the path joined to the current directory (see
   `search_str_for_entry`). Every compiled pattern must match (AND semantics
   across `--and`).
6. Apply `--extension`, `--type`, `--owner`, `--size` and `--changed-within`
   or `--changed-before`. Size filters look at metadata only for regular files.
7. If printing with colors, compute the LS_COLORS style now, in parallel,
   so the receiver does not have to.
8. Send the entry with `BatchSender::send`. If the receiver is gone, quit.
9. If `--prune` is set, return `WalkState::Skip` so matched directories are not
   descended into. Otherwise continue.

Errors from the walker are not fatal; they flow through the same channel
and are either printed (with `--show-errors`) or dropped by the receiver.

## Batching

`BatchSender` accumulates `WorkerResult` values into a shared
`Arc<Mutex<Option<Vec<_>>>>` batch. A batch is sent over the channel when its
first item is pushed, and it is considered full at `limit` items.

- Normal runs use a limit of `0x100` (256).
- When `--exec` runs a non-batch command with more than one thread, the limit
  is `1`, so each job gets work as soon as it is found and the job threads
  share the load evenly.

Once the receiver takes a batch, its `Option` is set to `None`, and the sender
starts a new batch on the next push. This avoids copying entries between
threads.

## Receiver: buffering and streaming

`ReceiverBuffer` is the single consumer on the main output path. It starts in
`ReceiverMode::Buffering` with a deadline of `now + max_buffer_time`
(default 100 ms, configurable with `--max-buffer-time`).

- While buffering, each entry is pushed into `buffer`. The receiver waits on
  the channel only until the deadline. If the deadline passes without a batch,
  `stream()` runs.
- If the buffer grows beyond 1000 entries (`MAX_BUFFER_LENGTH`), `stream()`
  runs immediately.
- `stream()` switches to `Streaming`, prints the buffered entries in their
  current order, and flushes.
- In `Streaming` mode, each entry is printed as it arrives, and stdout is
  flushed whenever the channel is momentarily empty.

When the channel disconnects (all senders finished), `stop()` runs. If the
receiver is still buffering, it sorts the buffer by path (the `Ord`
implementation of `DirEntry` compares paths) and then streams it. This is why
fast searches produce sorted output while long-running searches stream
unsorted output.

The practical consequence: output ordering is deterministic only for searches
that finish within the buffer window. Do not rely on order for long searches.

## Printing and errors

`ReceiverBuffer::print` delegates to `output::print_entry`. Two outcomes are
treated specially:

- A `BrokenPipe` write error is not reported as a message. A failing `flush`
  still returns `GeneralError` without a message, so a closed pipe ends the
  run with exit status 1 rather than a diagnostic.
- Any other write error is reported as `Could not write to output` and the
  result is `GeneralError`.

If `interrupt_flag` is set during printing, the receiver flushes once and
returns `KilledBySigint`.

Entries delivered with `--quiet` never print. The first entry sets the
receiver's result to `HasResults(true)` immediately.

## Exit status produced here

`ReceiverBuffer::stop` determines the exit code when the walk ends:

| Condition | Result |
| --- | --- |
| `--quiet` | `HasResults(num_results > 0)`: exit 0 if anything matched, exit 1 otherwise |
| not quiet | `Success` (exit 0), even when nothing matched |

The full table, including `GeneralError` and `KilledBySigint` (130), is in
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
the [System Overview](/openwiki/architecture/overview.md).

## Quit and interrupt semantics

- `quit_flag` is checked at the start of every sender callback and is set when
  the receiver stops early (for example by `--max-results` reaching its limit,
  or by `--quiet` seeing a match, or by an output error).
- `--max-results` is counted in the receiver, not in the senders, so senders
  may already have produced a few more entries than the limit before the quit
  flag is observed.
- Ctrl-C handling is only installed when results are printed and colors are
  enabled. In other modes the default SIGINT behavior terminates the process.

## Extension seams

- New per-entry predicates belong in the sender closure, after the cheap
  name check and before the send. Keep the cheapest tests first; metadata
  reads are the expensive part.
- Changes to batching (for example batch sizes for a new execution mode) are
  made in `spawn_senders`, where the `limit` is chosen.
- Changes to ordering or buffering are made in `ReceiverBuffer` and are
  exercised by integration tests that check output order.

## Tests

Unit tests at the bottom of `src/walk.rs` cover `search_str_for_entry`, which
determines what string a pattern is matched against. Behavioral tests for
pruning, depth, ignore files and output ordering are in `tests/tests.rs`. See
<!-- openwiki: broken internal link [/openwiki/testing/integration-tests.md] link "/openwiki/testing/integration-tests.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Testing Strategy](/openwiki/testing/integration-tests.md).

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [System Overview](/openwiki/architecture/overview.md)
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)
<!-- openwiki: broken internal link [/openwiki/architecture/search-filters.md] link "/openwiki/architecture/search-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Search Filters and Ignore Rules](/openwiki/architecture/search-filters.md)
<!-- openwiki: broken internal link [/openwiki/workflows/output-formatting.md] link "/openwiki/workflows/output-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Output Formatting](/openwiki/workflows/output-formatting.md)
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Command Execution](/openwiki/workflows/command-execution.md)
