---
type: architecture
title: Parallel Walk and Result Pipeline
description: The sender/receiver design in walk.rs - how fd builds a parallel ignore-crate walker, filters entries on worker threads, batches results through a bounded channel, and buffers then streams output, including quiet, max-results and Ctrl-C behavior.
tags: [walk, concurrency, channel, batching, performance, sigint]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
sources:
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-8b3eaed746bb796650559c48
    resource: repo://src/filetypes.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# Parallel Walk and Result Pipeline

`src/walk.rs` is fd's engine. It couples the `ignore` crate's `WalkParallel` (many producer threads) with a single consumer that prints or executes. See [[architecture/overview]] for how it is invoked.

## Walker construction

`WorkerState::build_walker` configures a `WalkBuilder` rooted at the first search path (other paths are added with `builder.add`). Settings are derived from `Config`: hidden, `.fdignore`, parent ignore, git ignore/global/exclude, `require_git`, overrides, `follow_links`, `same_file_system` and `max_depth`. It adds the custom `.fdignore` filename, the global ignore file at `<config_dir>/fd/ignore` (via `etcetera`) and any `--ignore-file` files; malformed patterns are reported as errors, but `Partial` errors are tolerated. `--exclude` globs become `Override`s prefixed with `!`. The mapping and precedence are explained in [[concepts/ignore-rules-and-hidden-files]].

## Sender side: per-entry decision

`spawn_senders` calls `walker.run`, creating one closure per worker thread, each with its own `BatchSender`. For every walk event the closure decides in this order:

1. If `quit_flag` is set, return `WalkState::Quit`.
2. For directories, if they contain any `--ignore-contain` marker file, `Skip` the subtree. The type is checked first to avoid syscalls. Depth-0 (the root) is skipped without being reported.
3. Convert the event to a `DirEntry`. A `NotFound` error on a path that is a symlink (checked via `symlink_metadata`) becomes `DirEntry::broken_symlink`, so dangling links are still reported; other errors are sent as `WorkerResult::Error`.
4. Enforce `min_depth` (broken symlinks have no depth and are dropped when a minimum is set).
5. **Name match:** all patterns must match the search string — the file name, or the absolute path under `--full-path` (`search_str_for_entry` strips a leading `./` and joins the stored cwd). See [[architecture/pattern-matching]].
6. Extension regex set, then file-type filter, owner (Unix), size and time filters — see [[concepts/entry-filters]]. Size filters accept only regular files.
7. If printing in color, compute the entry's LS_COLORS style *on the worker thread* so styling cost is parallelized.
8. Send the entry; a closed channel yields `Quit`. With `--prune`, matching directories return `Skip` so their contents are not visited.

## Batching and backpressure

`BatchSender` accumulates `WorkerResult`s in a `Batch` (an `Arc<Mutex<Option<Vec<_>>>>`). The first push into a new batch sends the batch handle over the channel immediately; subsequent pushes append under the mutex until the batch reaches its limit (256 by default, 1 when distributing one-by-one commands across multiple threads). When the receiver takes a batch (`Option::take`), the sender sees `None` and starts a fresh batch. This lets the consumer start work early while amortizing channel operations. The channel is bounded at `2 × threads`, so slow consumers throttle the walkers.

## Receiver: buffer then stream

`ReceiverBuffer` has two modes:

- **Buffering** — entries accumulate in a `Vec` for up to `max_buffer_time` (default 100 ms, adjustable via `--max-buffer-time`) or until more than 1000 entries arrive. If the walk ends first (`Disconnected`), the buffer is **sorted** by path and printed, giving deterministic output for quick searches.
- **Streaming** — after the deadline (`Timeout`) or buffer overflow, the buffer is flushed (unsorted) and every later entry is printed immediately; stdout is flushed whenever the channel is empty.

Other receiver behavior:

- `--quiet` returns on the first entry with `ExitCode::HasResults(true)`; at the end `HasResults(num_results > 0)`.
- `--max-results` calls `stop()` once the count is reached, which sorts and flushes if still buffering.
- Walker errors are printed only with `--show-errors`.
- A `BrokenPipe` write error is ignored (e.g. `fd | head`), while other write errors yield `GeneralError`.
- On any terminating condition the receiver sets `quit_flag`, which makes all walker threads stop at their next entry.

## Ctrl-C handling

When colored printing is active (`ls_colors.is_some() && is_printing()`), `scan` installs a `ctrlc` handler. The first Ctrl-C sets `quit_flag` and `interrupt_flag`, letting the receiver flush any buffered output cleanly and return `KilledBySigint`; a second Ctrl-C exits immediately. This is so the terminal's colors are reset instead of being left in a styled state. After the scope ends, an interrupt overrides the exit code (the process then re-raises SIGINT; see [[architecture/overview]]).

## Supporting types

- `DirEntry` (`src/dir_entry.rs`) wraps `ignore::DirEntry` or a broken-symlink path, with lazily cached metadata and style (see [[architecture/output-and-terminal-safety]]).
- `FileTypes::should_ignore` (`src/filetypes.rs`) treats an entry as filtered out when its type is not selected, is non-executable under `--type x`, is non-empty under `--type e`, or is an unknown type. `filesystem::is_empty` checks files by size 0 and directories by lack of entries.
- `filesystem.rs` provides `osstr_to_bytes` (raw bytes on Unix, lossy UTF-8 on Windows), `strip_current_dir`, absolute-path helpers and platform-gated `is_*` file-type predicates.

## Testing

`walk.rs` has unit tests for `search_str_for_entry`; behavior of the full pipeline is covered by the integration tests described in [[operations/testing]] (for example `test_max_results`, `test_quiet`, `test_prune`, `test_follow_broken_symlink`).
