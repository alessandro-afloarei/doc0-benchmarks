---
type: architecture
title: Parallel Search Pipeline
description: How src/walk.rs runs the search. A multi-threaded ignore::WalkParallel produces filtered entries, a batched bounded channel carries them, and a receiver either buffers and sorts them, streams them to stdout, or hands them to exec workers. Also covers early exit, quiet mode, and Ctrl-C handling.
tags: [architecture, walk, concurrency, channel, buffering, signals]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# Parallel Search Pipeline

`walk::scan(paths, patterns, config)` is the core of fd. It wraps the inputs in a `WorkerState` and runs a producer/consumer pipeline:

- **Senders**: the `ignore` crate's `WalkParallel` thread pool, with `config.threads` threads. Each worker runs an fd closure on every directory entry.
- **Channel**: a `crossbeam_channel::bounded(2 * threads)` channel that carries `Batch` values.
- **Receiver**: one thread running `WorkerState::receive`. It either prints results or dispatches them to command execution.

Everything runs inside `std::thread::scope`, so worker closures borrow `Config` and the regexes directly.

## Building the walker

`build_walker` configures `ignore::WalkBuilder` from the first search path. Additional search paths are added with `builder.add(path)`, so they all share one walker and one thread pool. Ignore-related settings (`hidden`, `ignore`, `parents`, `git_ignore`, `git_global`, `git_exclude`, `require_git`, overrides from `--exclude`, custom `.fdignore`, global and custom ignore files) are covered in [Ignore Rules and Traversal Controls](../concepts/ignore-rules-and-traversal.md). The walker also gets `follow_links`, `same_file_system`, and `max_depth`, then is built with `threads(config.threads).build_parallel()`.

## Per-entry processing on worker threads

`spawn_senders` gives each walker thread a closure with its own `BatchSender`. For every entry, the closure does the following in order and returns `WalkState::Quit`, `Skip`, or `Continue`:

1. **Quit check**: if `quit_flag` is set, return `Quit`.
2. **`--ignore-contain`**: if the entry is a directory that contains any of the named marker files, return `Skip`, which stops descent.
3. **Root skip**: depth-0 entries (the search roots themselves) are never reported.
4. **Error handling**: a walk error whose I/O kind is `NotFound` on a path that is a symlink becomes a `DirEntry::broken_symlink`, so broken links are still reported. Other errors are sent as `WorkerResult::Error`.
5. **`--min-depth`**: entries that are too shallow are dropped. Broken symlinks have no depth, so they are also dropped when a minimum depth is set.
6. **Name match**: every regex must match (`all`, which implements `--and`) against either the file name or the absolute path (`--full-path`). See [Pattern Matching](../concepts/pattern-matching.md).
7. **Metadata filters**, cheapest first: extension, file type, owner (Unix), size, modification time. See [Entry Filters](../concepts/entry-filters.md).
8. **Styling**: when printing with colors, `entry.style(ls_colors)` is computed here, on the worker thread, so LS_COLORS lookups run in parallel.
9. **Send**: `tx.send(WorkerResult::Entry(entry))`. A send error means the receiver is gone, so the closure returns `Quit`.
10. **`--prune`**: after a match is sent, return `Skip` so fd does not descend into the matched directory.

Name matching comes before any metadata-based filter because it needs no syscalls.

## Batch channel protocol

Sending one channel message per entry would be expensive, so `BatchSender` groups results:

- A `Batch` is an `Arc<Mutex<Option<Vec<WorkerResult>>>>`.
- When a worker pushes the **first** item into a fresh batch, it sends a clone of the `Arc` over the channel right away. Later items are appended to the same shared vector while the batch waits in the channel.
- When the receiver iterates a batch, it `take()`s the vector and leaves `None`. The next `send` on that worker sees `None` (or a batch that reached the size `limit`) and starts a new batch.
- The `limit` is `0x100` (256) items. In `--exec` (one-by-one) mode with more than one thread it is **1**, so each job thread pulls single entries and work spreads evenly.

The bounded channel capacity (`2 * threads`) applies backpressure to the walker when the receiver falls behind.

## Receiver: buffering vs streaming

When no command is configured, the receiver wraps a locked, `BufWriter`-wrapped stdout in a `ReceiverBuffer`. It starts in **Buffering** mode:

- It waits with `recv_deadline(deadline)`. The deadline is `max_buffer_time`, default **100 ms**, settable with the hidden `--max-buffer-time` option.
- Entries collect in a `Vec<DirEntry>`. If the walk finishes (the channel disconnects) before the deadline, the buffer is **sorted by path** and printed. Fast searches therefore get deterministic, sorted output.
- If the deadline passes, or the buffer grows past `MAX_BUFFER_LENGTH` (1000), the receiver switches to **Streaming**. It prints the buffer unsorted and from then on prints each entry as it arrives. In streaming mode it flushes stdout whenever the channel is momentarily empty.

### Early termination

- `--max-results N` (and `-1`): after N results, `stop()` prints what is left and returns. `process()` then sets `quit_flag`, and walker threads return `Quit` on their next entry.
- `--quiet`: the first entry returns `ExitCode::HasResults(true)` right away. If the walk ends with no entry, `HasResults(false)` is returned, which maps to exit status 1.
- Write errors: `BrokenPipe` on print is ignored, so piping into `head` is not an error. Other write errors print `Could not write to output` and return `GeneralError`. A failed flush also returns `GeneralError`.

## Exec dispatch

If `config.command` is set, `receive` does not print. Instead:

- **Batch mode** (`--exec-batch`, `--list-details`): the receiver thread itself runs `exec::batch` over the flattened channel iterator.
- **One-by-one mode** (`--exec`): it spawns `config.threads` scoped job threads. Each one runs `exec::job` on a clone of the receiver. Their exit codes are combined with `merge_exitcodes`.

Details are in [Command Execution](../workflows/command-execution.md).

## Shutdown and Ctrl-C

Two `Arc<AtomicBool>` flags coordinate shutdown:

- `quit_flag` stops the walk cleanly. It is set by the receiver on finish or by the Ctrl-C handler.
- `interrupt_flag` records that SIGINT was received.

A `ctrlc` handler is installed **only when output is colorized and fd is printing**. That is the case where an interrupted escape sequence could leave the terminal in a bad state. On the first Ctrl-C the handler sets both flags. The receiver notices `interrupt_flag` after its next print, flushes, and returns `KilledBySigint`. A second Ctrl-C exits immediately. In every other mode, SIGINT keeps its default behavior. After the scope ends, `scan` returns `KilledBySigint` if the interrupt flag was set. `ExitCode::exit` then re-raises SIGINT on Unix (see [Exit Codes, Errors and Signals](../operations/exit-codes-and-errors.md)).

## Ordering guarantees

- Output is sorted **only** when the whole search finishes within the buffer window and produces at most 1000 results. Otherwise order is nondeterministic.
- `DirEntry` ordering and equality are both defined by path.
- Exec order is never guaranteed. The CLI help says so explicitly.

## Tests

- Unit tests in `src/walk.rs` cover `search_str_for_entry` (filename vs `--full-path` search string, `./` stripping).
- Integration tests in `tests/tests.rs` drive these behaviors end to end: max results, quiet, prune, min/max depth, broken symlinks. See [Testing Strategy](../testing/integration-tests.md).
