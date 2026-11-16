---
type: architecture
title: Parallel Walk, Batching, and the Receiver
description: How fd's walk module drives a multi-threaded ignore::WalkParallel traversal, filters entries in sender threads, batches results over a bounded channel, and how a single receiver buffers, sorts, streams, or dispatches results to command execution.
tags: [architecture, traversal, concurrency, walk, output, exec]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
sources:
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Parallel Walk, Batching, and the Receiver

`src/walk.rs` is the runtime core of fd. Once `main.rs` has produced the compiled
pattern regexes and the immutable `Config` (see
[Search Pipeline](search-pipeline.md)), it calls `walk::scan(paths, patterns, config)`,
which wraps everything in a `WorkerState` and runs a producer/consumer pipeline:

```
            ignore::WalkParallel (N threads)            bounded(2*N) channel
 paths ──► sender closure per thread ──► BatchSender ──────────────► receiver
           (match + filter + style)        (Batch = Arc<Mutex<Vec>>)   │
                                                                      ├─ ReceiverBuffer → stdout
                                                                      ├─ exec::job × N threads
                                                                      └─ exec::batch (1 thread)
```

## Shared state

`WorkerState` holds the compiled `patterns`, the `Config`, and two `Arc<AtomicBool>`
flags:

- `quit_flag` — set to stop the walk cleanly (receiver finished, max results hit,
  or Ctrl-C). Every sender closure checks it first and returns `WalkState::Quit`.
- `interrupt_flag` — set specifically by the Ctrl-C handler so the receiver and
  `scan` can report `ExitCode::KilledBySigint`.

## Building the walker

`build_walker` configures `ignore::WalkBuilder` starting from the first search
path and `add`s the remaining ones. It maps Config fields onto the builder:
hidden filtering, `.ignore`/`.fdignore`, gitignore/global git/exclude files,
`require_git`, parent-directory ignore files, `--exclude` overrides (built by
`build_overrides` as `!pattern` globs rooted at the first path), symlink
following, `same_file_system`, and `max_depth`. It also appends the global fd
ignore file and any `--ignore-file` paths, printing (but not failing on)
malformed patterns. The thread count comes from `config.threads`. Details of the
ignore semantics live in [Ignore Rules and Hidden Files](../concepts/ignore-rules-and-hidden-files.md).

## Sender threads: per-entry decision chain

`spawn_senders` calls `walker.run`, which creates one closure per walker thread.
Each closure owns a `BatchSender` and decides, for every entry the walker yields:

1. Quit if `quit_flag` is set.
2. For directories, skip the whole subtree (`WalkState::Skip`) if any
   `--ignore-contain` marker file exists inside it.
3. Skip the depth-0 root entry itself (it is never a result).
4. Convert walker errors: a `NotFound` error on a path that is itself a symlink
   becomes `DirEntry::broken_symlink(path)`; any other error is sent as
   `WorkerResult::Error` and the walk continues.
5. Apply `min_depth`, then the name/path regex match (all patterns must match),
   then extension, file-type, owner (unix), size and modification-time filters
   (see [Entry Filters](../concepts/entry-filters.md)).
6. When printing (no command) with colors enabled, precompute the LS_COLORS
   style in the worker thread so coloring cost is parallelized.
7. Send `WorkerResult::Entry`; if the channel is closed, return `Quit`.
8. With `--prune`, return `Skip` so matching directories are not descended.

Name matching is the first filter because it needs no metadata.
`search_str_for_entry` returns only the file name by default, or the absolute
path (cwd joined with the `./`-stripped relative path) when `--full-path` set
`full_path_base`.

`DirEntry` (`src/dir_entry.rs`) wraps either an `ignore::DirEntry` or a broken
symlink path and lazily caches `metadata()` and the LS_COLORS `style()` in
`OnceCell`s, so the multiple filters that need metadata stat each entry at most
once. Broken-symlink entries report no depth, so `--min-depth` excludes them.

## Batching and backpressure

Results are not sent one at a time. `BatchSender` accumulates items into a
`Batch` (an `Arc<Mutex<Option<Vec<WorkerResult>>>>`) and sends the batch handle
over the channel as soon as its *first* item is pushed; later items are appended
in place while the batch sits in the queue. When the receiver iterates a batch it
`take()`s the vector, leaving `None`, which tells the sender to start a new batch.
A sender also starts a new batch once the current one reaches its `limit`
(0x100 by default), providing backpressure. In one-by-one `--exec` mode with more
than one thread, the limit is 1 so work is distributed evenly across the job
threads.

The channel itself is `crossbeam_channel::bounded(2 * threads)`.

## Receiver modes

`receive` chooses the consumer:

- `--exec-batch` / `--list-details` (batch mode): `exec::batch` on the receiver
  thread, consuming the flattened channel.
- `--exec` (one-by-one): `config.threads` scoped job threads, each consuming a
  clone of the receiver; their exit codes are merged.
- Otherwise: a `ReceiverBuffer` writing to a locked, `BufWriter`-wrapped stdout.

See [Command Execution](../features/command-execution.md) for the exec paths.

### ReceiverBuffer: buffer, sort, then stream

`ReceiverBuffer` starts in `Buffering` mode with a deadline of
`max_buffer_time` (hidden `--max-buffer-time`, default 100 ms). While buffering it
waits on `recv_deadline`; entries are collected in a vector. It switches to
`Streaming` (flushing the buffer in arrival order) when the deadline passes or
the buffer exceeds `MAX_BUFFER_LENGTH` (1000). If the channel disconnects while
still buffering, the buffer is **sorted by path** before printing. The effect:
small, fast searches produce deterministically sorted output; large or slow ones
stream promptly in nondeterministic order.

In streaming mode each entry is printed immediately via `output::print_entry`
(see [Output Formatting](../features/output-formatting.md)), and stdout is flushed
whenever the channel is momentarily empty.

Other receiver behavior:

- `--quiet`: the first entry ends the loop with `ExitCode::HasResults(true)`;
  at the end with no entries it returns `HasResults(false)`.
- `--max-results`: once `num_results` reaches the limit, `stop()` is called.
- Errors are printed only with `--show-errors`.
- Write errors other than `BrokenPipe` print an error and return
  `GeneralError`; a failing flush (typically a broken pipe) also exits with
  `GeneralError`.
- Whenever `poll` returns an exit code, `process` sets `quit_flag` so the walker
  threads stop.

## Ctrl-C handling

When output is colorized and printing (not executing commands), `scan` installs a
`ctrlc` handler: the first Ctrl-C sets `quit_flag` and `interrupt_flag`; a second
Ctrl-C calls `ExitCode::KilledBySigint.exit()` immediately. The receiver checks
`interrupt_flag` after each printed entry, flushes, and returns
`KilledBySigint` (printing one entry at a time means output stops between
entries rather than mid-escape-sequence). After the scoped threads join, `scan` returns
`KilledBySigint` if the interrupt flag is set, regardless of the receiver's code.
See [Exit Codes and Errors](../reference/exit-codes-and-errors.md).

## Ordering and lifecycle

`scan` runs in `thread::scope`: the receiver thread is spawned first, then
`spawn_senders` blocks the calling thread while the walk runs. When all walker
threads finish, every `Sender` clone is dropped, the receiver sees
`Disconnected`, and the scope joins the receiver to obtain the exit code.

## Tests

- `walk.rs` unit tests cover `search_str_for_entry` for relative, `./`-prefixed,
  and absolute paths with and without `--full-path`.
- Integration tests in `tests/tests.rs` exercise max results, quiet mode, prune,
  ignore-contain and broken symlinks end to end (see
  [Test Suite](../testing/test-suite.md)).
