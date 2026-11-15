---
type: architecture
title: Parallel Walk and Result Receiver
description: How src/walk.rs drives the ignore crate's parallel walker, filters each entry in the sender callbacks, batches results over a bounded channel, and consumes them with a buffering-then-streaming receiver that sorts fast results, honors --max-results/--quiet, and handles Ctrl-C.
tags: [walk, concurrency, channel, receiver, dir-entry]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# Parallel Walk and Result Receiver

`src/walk.rs` is the engine of fd. The public entry point is `walk::scan(paths, patterns, config)`, which creates a `WorkerState` and calls its `scan` method. `WorkerState` holds the compiled patterns, the `Config`, and two shared atomic flags: `quit_flag` (cooperative shutdown) and `interrupt_flag` (set by Ctrl-C).

## Lifecycle of a scan

1. **Build the walker** (`build_walker`): an `ignore::WalkBuilder` rooted at the first search path, with additional paths added via `builder.add`. It sets hidden/ignore/gitignore options, `--exclude` overrides, `follow_links`, `same_file_system`, `max_depth`, the `.fdignore` custom filename, the global ignore file, and `--ignore-file` files, then calls `build_parallel()` with `config.threads`. Details of the ignore mapping are on [Ignore Rules and Hidden Files](../concepts/ignore-rules-and-hidden-files.md).
2. **Install a Ctrl-C handler** – only when colors are enabled *and* results are being printed (the case where an interrupted escape sequence could leave the terminal colored). The first Ctrl-C sets both flags; a second Ctrl-C exits immediately with `KilledBySigint`.
3. **Create a bounded channel** `crossbeam_channel::bounded(2 * threads)` carrying `Batch` values.
4. **Run inside `thread::scope`**: spawn the receiver on a scoped thread, then run the sender callbacks on the walker's own thread pool (`walker.run`, which blocks until the walk ends), then join the receiver.
5. If `interrupt_flag` is set at the end, return `ExitCode::KilledBySigint`; otherwise return the receiver's exit code.

## The sender side

`spawn_senders` gives the walker a factory closure; each walker thread gets its own `BatchSender` and a per-entry callback that returns a `WalkState` (`Continue`, `Skip` to not descend, or `Quit`). For each entry the callback does, in order:

1. **Quit check** – if `quit_flag` is set, return `Quit`.
2. **`--ignore-contain`** – if a directory contains any of the named marker files (e.g. `CACHEDIR.TAG`), return `Skip` so it is neither reported nor descended into. The file type is checked first to avoid needless `stat` calls.
3. **Skip the root** (depth 0).
4. **Error handling** – a `NotFound` error whose path is a symlink becomes `DirEntry::broken_symlink(path)` (so broken symlinks are still reported); every other error is sent as `WorkerResult::Error`.
5. **`--min-depth`** – entries shallower than the minimum (or broken symlinks, which have no depth) are skipped but traversal continues.
6. **Pattern match** – every regex must match (`all`) the search string: the file name, or the absolute path under `--full-path` (`search_str_for_entry`).
7. **Extension, file type, owner (Unix), size, modification time** filters – see [Entry Filters](../concepts/entry-filters.md).
8. **Precompute color** – when printing with colors, `entry.style(ls_colors)` is called here so the `LS_COLORS` lookup happens in parallel on the walker threads and is cached in the entry.
9. **Send** the `WorkerResult::Entry`; a send error (receiver gone) returns `Quit`.
10. **`--prune`** – return `Skip` so matching directories are not descended into.

Because the regex check precedes filters that need metadata, most non-matching entries cost no extra syscalls.

### Batching and backpressure

`BatchSender` wraps a shared `Batch` (`Arc<Mutex<Option<Vec<WorkerResult>>>>`). The batch is sent over the channel as soon as its *first* item is pushed; the sender keeps appending to the same shared vector until either the receiver has taken it (`Option` is `None`) or it reaches `limit` items, at which point a fresh batch is started. This gives low latency (the receiver can grab a batch immediately) while amortizing channel operations. The default limit is `0x100` (256). In `--exec` (non-batch) mode with more than one thread the limit is 1, so work is spread evenly across the multiple exec receiver threads. The bounded channel provides backpressure when the consumer is slower than the walkers.

## The receiver side

`WorkerState::receive` chooses the consumer:

- **`--exec`**: spawns `config.threads` scoped threads, each running `exec::job` over a clone of the receiver; their exit codes are merged.
- **`--exec-batch` / `--list-details`**: runs `exec::batch` on the receiver thread.
- **Otherwise**: `ReceiverBuffer` writing to a locked, `BufWriter`-wrapped stdout.

See [Command Execution](../features/command-execution.md) for the exec consumers.

### `ReceiverBuffer`: buffering then streaming

`ReceiverBuffer` has two modes:

- **Buffering** (initial): results are collected into a `Vec<DirEntry>`. Receiving uses `recv_deadline(deadline)` where the deadline is `now + max_buffer_time` (default 100 ms, overridable by the hidden `--max-buffer-time` option). If the buffer grows beyond `MAX_BUFFER_LENGTH` (1000) or the deadline passes, it switches to streaming and dumps the buffer unsorted.
- **Streaming**: each entry is printed immediately with `output::print_entry`. Stdout is flushed whenever the channel is momentarily empty.

When the channel disconnects (all senders finished) while still buffering, the buffer is **sorted by path** (`DirEntry` implements `Ord` by path) before printing. So quick searches produce sorted, deterministic output; long searches stream in arrival order.

### Early termination

- **`--quiet`**: the first entry returns `ExitCode::HasResults(true)` immediately; at disconnection it returns `HasResults(num_results > 0)`.
- **`--max-results` / `-1`**: after `num_results` reaches the limit, `stop()` flushes (sorted if still buffering) and returns.
- Whenever `process()` ends, it sets `quit_flag`, which makes every walker callback return `WalkState::Quit` and drops senders.
- **Output errors**: a write error other than `BrokenPipe` prints "Could not write to output" and returns `GeneralError`; a failed flush (typically a broken pipe) also ends with `GeneralError` without an error message.
- **Ctrl-C**: after each printed entry the receiver checks `interrupt_flag` and, if set, flushes and returns `KilledBySigint`.

Filesystem errors received as `WorkerResult::Error` are printed only with `--show-errors`.

## `DirEntry` (`src/dir_entry.rs`)

`DirEntry` wraps either an `ignore::DirEntry` or a `BrokenSymlink(PathBuf)`, and lazily caches two expensive values in `OnceCell`s:

- `metadata()` – `stat` result (or `symlink_metadata` for broken symlinks), computed once and shared by owner/size/time filters and coloring.
- `style()` – the `LS_COLORS` style, computed once (on the walker thread, see step 8).

Other behaviors:

- `depth()` is `None` for broken symlinks, which is why they are dropped by `--min-depth`.
- `stripped_path(config)` removes the leading `./` when `strip_cwd_prefix` is enabled, **unless** the result would start with `-`, in which case the `./` is kept so downstream tools don't parse the path as an option.
- Equality and ordering are by path, used for the sorted output.
- It implements `lscolors::Colorable` so `LsColors::style_for` can use the cached file type and metadata.

## Tests

`walk.rs` has unit tests for `search_str_for_entry` (relative, `./`-prefixed, and absolute paths with and without a full-path base). `dir_entry.rs` tests the dash-prefix detection. End-to-end behavior (sorting, max-results, quiet, prune, min-depth) is covered by `tests/tests.rs` – see [Testing](../testing/integration-tests.md).
