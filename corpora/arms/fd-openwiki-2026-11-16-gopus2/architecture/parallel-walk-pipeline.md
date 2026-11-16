---
type: architecture
title: Parallel Walk Pipeline
description: The concurrency model of fd's search in src/walk.rs - parallel walker sender callbacks, eagerly-sent shared batches over a bounded channel, the buffering-then-streaming receiver that sorts fast searches, early termination for --max-results and --quiet, and Ctrl-C handling.
tags: [walk, concurrency, threads, channel, buffering, ignore-crate, sigint]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:22.809Z
sources:
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T16:28:22.809Z" }
---

# Parallel Walk Pipeline

`src/walk.rs` owns the search runtime. Its public surface is a single function, `walk::scan(paths, patterns, config) -> Result<ExitCode>`, which wraps everything in a `WorkerState` and returns once all output has been written or all commands have finished.

## Components

| Type | Role |
|------|------|
| `WorkerState` | Owns `patterns: Vec<Regex>`, `config: Config`, and two `Arc<AtomicBool>` flags: `quit_flag` (stop the walk cleanly) and `interrupt_flag` (Ctrl-C seen). |
| `WorkerResult` | Message type: `Entry(DirEntry)` or `Error(ignore::Error)`. |
| `Batch` | `Arc<Mutex<Option<Vec<WorkerResult>>>>` — a shared, growable vector of results. |
| `BatchSender` | Per-walker-thread wrapper around the channel `Sender<Batch>` with a size `limit`. |
| `ReceiverBuffer` | The printing consumer: buffering/streaming state machine writing to a locked, `BufWriter`-wrapped stdout. |
| `DirEntry` (`src/dir_entry.rs`) | Wrapper over `ignore::DirEntry` or a broken-symlink `PathBuf`, caching metadata and `LsColors` style in `OnceCell`s. |

## `scan` flow

1. `build_walker` configures `ignore::WalkBuilder` from `Config` (ignore files, overrides from `--exclude`, symlink following, same-file-system, max depth, thread count). The first search path is the builder root; additional paths are `add`ed. See [Filtering and Ignore Rules](../concepts/filtering-and-ignore-rules.md).
2. If output is colorized **and** results are being printed, a `ctrlc` handler is installed (see below).
3. A bounded crossbeam channel of capacity `2 * threads` carrying `Batch` values is created.
4. Inside `std::thread::scope`, one receiver thread runs `self.receive(rx)`, and the current thread calls `spawn_senders`, which blocks in `WalkParallel::run` until the walk finishes. Dropping the senders disconnects the channel, letting the receiver finish.
5. The receiver's `ExitCode` is returned, replaced by `KilledBySigint` if the interrupt flag was set.

## Sender side

`spawn_senders` gives each walker thread its own `BatchSender`. The batch limit is `0x100` (256) results, or **1** when running `--exec` (not batch mode) with more than one thread, so work is spread evenly across the parallel job threads.

The per-entry callback:

1. Returns `WalkState::Quit` as soon as `quit_flag` is set.
2. For directories, returns `Skip` if any `--ignore-contain` name exists inside it. This check runs before the depth-0 check, so it also applies to the search root.
3. Skips (but continues into) the depth-0 root entry — roots are never reported.
4. Converts walk errors: a `NotFound` error whose path is itself a symlink becomes `DirEntry::broken_symlink(path)`; any other error is sent as `WorkerResult::Error`.
5. Applies the filter chain (min depth, patterns, extension, type, owner, size, time). Any rejection returns `Continue`.
6. Pre-computes the `LS_COLORS` style when printing with colors, so styling cost is paid in parallel.
7. Sends the entry; a send failure (receiver gone) returns `Quit`.
8. Returns `Skip` when `--prune` is set, so matching directories are not descended.

### Eager batch sending

`BatchSender::send` pushes into the current shared `Batch`. When a batch receives its **first** item, a clone of the `Arc` is immediately sent over the channel; later items keep being appended to the same vector while it waits in the channel. The receiver consumes a batch with `into_iter`, which `take`s the `Option`, leaving `None`. A sender that sees `None` (already taken) or a full batch (`len >= limit`) starts a new batch. This gives low latency for the first result and amortized channel traffic for large result sets, while the bounded channel provides backpressure.

## Receiver side (printing)

`ReceiverBuffer` starts in `Buffering` mode with a deadline of `--max-buffer-time` or the default **100 ms**.

```text
Buffering ──(timeout reached)──────────────► Streaming (print buffer unsorted, flush)
    │      ──(buffer > 1000 entries)───────► Streaming
    │
    └─(channel disconnected / max results)─► stop(): sort buffer, print, exit
```

- In `Buffering`, `recv_deadline(deadline)` is used; entries are pushed into `buffer`.
- In `Streaming`, `recv()` blocks indefinitely and entries are printed directly; stdout is flushed only when the channel is momentarily empty.
- `stop()` sorts the buffer (by path, via `DirEntry`'s `Ord`) only if still buffering. **Sorted output is therefore only guaranteed for searches that complete within the buffer time and produce at most 1000 results**; otherwise output order is the nondeterministic walk order.
- `--quiet`: the first entry returns `ExitCode::HasResults(true)`; if the channel closes with nothing, `HasResults(false)`.
- `--max-results`: after the N-th entry, `stop()` is called.
- `WorkerResult::Error` values are printed only with `--show-errors`.

`process()` loops on `poll()` until it returns an `ExitCode`, then stores `quit_flag = true` so that senders stop walking.

## Receiver side (commands)

If `config.command` is set, `receive` does not create a `ReceiverBuffer`:

- **Batch mode** (`--exec-batch`, `--list-details`): the receiver thread itself runs `exec::batch` over the flattened channel iterator.
- **One-by-one mode** (`--exec`): it spawns `threads` scoped job threads, each with a cloned `Receiver`, running `exec::job`; their exit codes are merged with `merge_exitcodes`.

See [Command Execution](../systems/command-execution.md).

## Interrupts and pipe errors

- The Ctrl-C handler (installed only when printing colorized output, which lets fd finish the current entry rather than dying mid-escape-sequence) sets `quit_flag` and `interrupt_flag`. A **second** Ctrl-C exits immediately with `KilledBySigint`.
- After every printed entry, the receiver checks `interrupt_flag`; if set, it flushes and returns `KilledBySigint`.
- Write errors of kind `BrokenPipe` are ignored per entry; other write errors print `Could not write to output` and return `GeneralError`. A failed `flush` (typically a closed pipe) ends the receiver with `GeneralError`.
- Without colors, no handler is installed and SIGINT uses the default disposition.

Exit code semantics are summarized in [Exit Codes and Error Handling](../concepts/exit-codes-and-errors.md).

## `DirEntry`

- `metadata()` is computed lazily once (`ignore::DirEntry::metadata` or `symlink_metadata` for broken links), so filters that need metadata (owner, size, time, empty) share one syscall.
- `file_type()` for broken symlinks comes from that metadata; `depth()` is `None` for broken symlinks, which makes them fail any `--min-depth` check.
- `stripped_path(config)` removes `./` when `strip_cwd_prefix` is on, **unless** the result would start with `-`, protecting downstream tools from option injection.
- Equality and ordering compare paths only.

## Tests

`walk.rs` unit tests cover `search_str_for_entry` (full-path vs file-name match strings). Integration tests exercising this module include `test_max_results`, `test_quiet`, `test_prune`, `test_follow_broken_symlink`, `test_single_and_multithreaded_execution`, and the `test_ignore_contain*` cases in `tests/tests.rs`.
