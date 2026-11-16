---
type: architecture
title: Parallel Walk, Batching and the Receiver Thread
description: Deep dive into src/walk.rs - how sender threads filter entries, how BatchSender and a bounded channel move results, how ReceiverBuffer switches from sorted buffering to streaming, and how quiet, max-results, broken symlinks and Ctrl-C are handled.
tags: [walk, concurrency, channels, buffering, sigint]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# Parallel Walk, Batching and the Receiver Thread

`src/walk.rs` is the runtime core. `walk::scan(paths, patterns, config)` builds a `WorkerState` (patterns, `Config`, `quit_flag`, `interrupt_flag`) and calls `WorkerState::scan`.

## Thread topology

`scan` creates `bounded(2 * config.threads)` channel of `Batch` values, then inside `thread::scope`:

- spawns one **receiver** (`self.receive(rx)`), and
- runs `spawn_senders`, which calls `WalkParallel::run` - the `ignore` crate spawns `config.threads` walker threads, each invoking a factory closure that creates a per-thread `BatchSender` and the per-entry callback.

When the walk finishes, the senders' `Sender` clones drop, the channel disconnects, and the receiver observes `RecvTimeoutError::Disconnected`, finalizing the run. The receiver's exit code is the process result unless `interrupt_flag` is set, in which case `KilledBySigint` wins.

<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
For the `--exec` case the receiver role is split: batch mode runs `exec::batch` on one thread, one-by-one mode spawns `threads` `exec::job` workers all pulling from cloned receivers (see [command execution](/openwiki/workflows/command-execution.md)).

## Batching and backpressure

Sending one channel message per entry would be expensive, so `BatchSender` accumulates results into a `Batch` - an `Arc<Mutex<Option<Vec<WorkerResult>>>>`. The *first* push into a fresh batch sends the (shared) batch handle over the channel; later pushes keep appending to the same vector under the lock until the receiver takes it (`IntoIterator` does `take()`), or the limit is reached. `needs_flush` starts a new batch when the vector hit `limit` or was already taken. The default limit is `0x100` (256); when running a non-batch command with more than one thread it is `1` so work is spread evenly across the job threads. The bounded channel then blocks senders when receivers lag.

## The sender callback: per-entry control flow

For each walker item (in `spawn_senders`), in order:

1. If `quit_flag` is set, return `WalkState::Quit`.
2. For directories, if any `--ignore-contain` name exists inside, return `WalkState::Skip` (the directory is pruned entirely, checked before the depth check, and the file-type check precedes the `exists` syscalls to avoid unnecessary stat calls).
3. Skip the depth-0 root entry.
4. Convert to a `DirEntry`. A `NotFound` error on a path that is actually a symlink becomes `DirEntry::broken_symlink` so dangling links are still listed; any other error is forwarded as `WorkerResult::Error` (a failed send quits the walk).
5. Apply `min_depth` (broken symlinks have no depth and are therefore excluded when a min depth is set).
6. Match **all** patterns against `search_str_for_entry`: the file name by default, or, with `--full-path`, the absolute path (relative paths are joined to `full_path_base` after stripping `./`).
<!-- openwiki: broken internal link [/openwiki/concepts/entry-filters.md] link "/openwiki/concepts/entry-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
7. Apply extension, file-type, owner (Unix), size and modification-time filters - see [entry filters](/openwiki/concepts/entry-filters.md). Size filtering only keeps regular files; time filtering requires readable metadata. Entries whose metadata cannot be read are excluded by those filters.
8. If printing with colors, precompute the LS_COLORS style *on the walker thread* (`entry.style`) so the single receiver thread doesn't do that work.
9. Send the entry; then, with `--prune`, return `Skip` so the matched directory is not descended into.

## ReceiverBuffer: sorted-then-streaming output

`ReceiverBuffer` has two modes (`ReceiverMode`):

- **Buffering** (initial): waits on `recv_deadline` until `now + max_buffer_time` (default 100 ms). Entries are appended to `buffer`; if the buffer exceeds `MAX_BUFFER_LENGTH` (1000) it switches to streaming.
- **Streaming**: prints each entry as it arrives, blocking on `recv()`; it flushes stdout whenever the channel is momentarily empty.

On a timeout it calls `stream()`, which flips the mode and prints the buffered entries *in arrival order*. If the walk ends while still buffering, `stop()` first sorts the buffer (`DirEntry` orders by path) and then prints, which is why small searches have stable sorted output and big ones don't. Stdout is a locked `BufWriter`.

### Termination conditions

`poll` returns `Err(ExitCode)` as a control-flow signal to stop; `process` then sets `quit_flag` so senders shut down:

- **`--quiet`**: on the first entry returns `HasResults(true)` immediately; at disconnect returns `HasResults(num_results > 0)`.
- **`--max-results` / `-1`**: after reaching the count calls `stop()` (sorting if still buffered), so the first N results seen are returned, not the lexicographically first N.
- **Disconnect** (walk complete): `stop()`.
- **Write errors**: `BrokenPipe` is ignored in `print`; other write errors print `Could not write to output` and yield `GeneralError`. A failing `flush` (probably a broken pipe) exits quietly with `GeneralError`.
- **Filesystem errors** (`WorkerResult::Error`) are only printed when `--show-errors` is set.

## Ctrl-C handling

<!-- openwiki: broken internal link [/openwiki/operations/exit-codes-and-error-handling.md] link "/openwiki/operations/exit-codes-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The handler is only installed when colors are on and the run is printing (`ls_colors.is_some() && is_printing()`), because that is when a terminal state (color escape sequences) might need restoring. The handler sets `quit_flag` and `interrupt_flag`; a *second* Ctrl-C exits immediately with `KilledBySigint`. `print` checks `interrupt_flag` after each entry, flushes, and returns `KilledBySigint`. `ExitCode::exit` then resets SIGINT to default and re-raises it so the parent shell sees a genuine signal death (see [exit codes](/openwiki/operations/exit-codes-and-error-handling.md)).

## DirEntry details that matter here

`DirEntry` (`src/dir_entry.rs`) caches metadata and style; `stripped_path(config)` removes a leading `./` only when `strip_cwd_prefix` is on *and* the result would not start with `-` (to prevent option injection when paths are passed to commands). Broken symlinks use `symlink_metadata`, and `depth()` is `None` for them.

## Tests and extension seams

<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/concepts/output-and-terminal-safety.md] link "/openwiki/concepts/output-and-terminal-safety.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Unit tests in `walk.rs` cover `search_str_for_entry`; behavior such as `test_max_results`, `test_quiet`, `test_prune`, `test_follow_broken_symlink`, `test_single_and_multithreaded_execution` and the `ignore_contain` tests live in `tests/tests.rs` ([harness](/openwiki/testing/integration-test-harness.md)). A new filter belongs in the sender closure, placed after cheaper checks and before the style computation; a new output mode belongs behind `ReceiverBuffer::print` / [`output::print_entry`](/openwiki/concepts/output-and-terminal-safety.md).
