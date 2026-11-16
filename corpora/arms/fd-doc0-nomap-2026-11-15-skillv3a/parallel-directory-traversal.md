---
title: "Parallel Directory Traversal"
---
## Overview

`walk::scan` is where the search happens. It hands the directory traversal to the `ignore` crate's parallel walker, runs fd's matching and filtering inside the walker threads, and sends each accepted entry over a channel to a single receiver. The walker threads are the senders; the receiver either prints results ([[Printing Results]]) or runs commands on them ([[Command Execution]]). This page covers the sender side: how the walker is configured, what each thread does with an entry, and how the threads stop.

Sources: [src/walk.rs:680-687](repo://src/walk.rs#L680-L687), [src/walk.rs:617-653](repo://src/walk.rs#L617-L653)

## WorkerState and scan

`scan` builds a `WorkerState` that owns the compiled regexes, the `Config` described on [[Command-Line Options and Configuration]], and two shared flags: `quit_flag` asks the walk to stop cleanly, and `interrupt_flag` records that Ctrl-C was pressed.

Sources: [src/walk.rs:305-328](repo://src/walk.rs#L305-L328)

`WorkerState::scan` then runs the search in four steps.

Sources: [src/walk.rs:617-619](repo://src/walk.rs#L617-L619)

1. `build_walker` creates the `ignore::WalkParallel` for the search paths.
2. When results are printed in colour, a Ctrl-C handler is installed: the first press sets both flags so the walk winds down and the receiver can reset the terminal; a second press exits at once with `KilledBySigint`.
3. A `crossbeam_channel::bounded` channel is created with room for `2 * threads` batches.
4. Inside `thread::scope`, the receiver thread is spawned first, then `spawn_senders` runs the walk on the current thread, which blocks until the walk ends; the receiver is then joined for its exit code.

Sources: [src/walk.rs:617-653](repo://src/walk.rs#L617-L653)

The Ctrl-C handler is only needed when colours are printed, because an interrupted escape sequence could leave the terminal coloured. If `interrupt_flag` is set when the walk ends, `scan` returns `KilledBySigint` whatever the receiver said; [[Errors and Exit Codes]] explains how that becomes exit status 130.

Sources: [src/walk.rs:621-634](repo://src/walk.rs#L621-L634), [src/walk.rs:648-652](repo://src/walk.rs#L648-L652)

## Configuring the walker

### Ignore rules

`build_walker` starts a `WalkBuilder` at the first search path and maps the `Config` ignore settings onto it.

Sources: [src/walk.rs:347-353](repo://src/walk.rs#L347-L353)

| `WalkBuilder` setting | From `Config` | Turned off by |
| --- | --- | --- |
| `hidden` | `ignore_hidden` | `-H`, `-u` |
| `ignore` (`.ignore` files) | `read_fdignore` | `-I`, `-u` |
| `git_ignore`, `git_global`, `git_exclude` | `read_vcsignore` | `-I`, `-u`, `--no-ignore-vcs` |
| `require_git` | `require_git_to_read_vcsignore` | `--no-require-git` |
| `parents` | `read_parent_ignore` and either ignore kind | `--no-ignore-parent` |
| `follow_links` | `follow_links` | on with `-L` |
| `same_file_system` | `one_file_system` | on with `--one-file-system` |
| `max_depth` | `max_depth` | `-d`, `--exact-depth` |

Sources: [src/walk.rs:347-365](repo://src/walk.rs#L347-L365)

With `require_git` on (the default), `.gitignore` files are honoured only inside a git repository, as git itself does. `parents` is turned off when neither `.fdignore` nor VCS files are read, since there is nothing to look for in parent directories.

Sources: [src/walk.rs:356-360](repo://src/walk.rs#L356-L360), [src/main.rs:316-317](repo://src/main.rs#L316-L317)

### Extra ignore files

When `.fdignore` files are read, `.fdignore` is registered as a custom ignore file name, so it works in every directory with `.gitignore` syntax. The global ignore file lives at `<config dir>/fd/ignore`, found with `etcetera::choose_base_strategy` (so `~/.config/fd/ignore` on Linux and macOS), and is added if it exists. Files given with `--ignore-file` are added after it. A malformed pattern in either is reported with `print_error` and the walk goes on; a partial error, where some lines were fine, is ignored.

Sources: [src/walk.rs:367-396](repo://src/walk.rs#L367-L396)

### Excludes and extra paths

`--exclude` globs are stored with a `!` prefix and added to an `OverrideBuilder` rooted at the first search path. In the `ignore` crate an override starting with `!` excludes matching paths, and overrides take precedence over every ignore file. A bad glob fails the run with "Malformed exclude pattern". The remaining search paths are added to the builder with `builder.add`, and `threads(config.threads)` sets the pool size before `build_parallel`.

Sources: [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/walk.rs:398-404](repo://src/walk.rs#L398-L404), [src/main.rs:387](repo://src/main.rs#L387-L387)

## The per-entry closure

`spawn_senders` calls `walker.run` with a factory that gives every walker thread its own closure and its own `BatchSender`. Each closure returns a `WalkState`: `Continue` to keep going, `Skip` to not descend into the directory, or `Quit` to stop the whole walk.

Sources: [src/walk.rs:442-459](repo://src/walk.rs#L442-L459)

```mermaid
flowchart TD
  start["entry from walker"] --> quit{"quit_flag set?"}
  quit -->|yes| q["Quit"]
  quit -->|no| ic{"directory containing an --ignore-contain name?"}
  ic -->|yes| skip["Skip"]
  ic -->|no| root{"depth 0?"}
  root -->|yes| cont["Continue"]
  root -->|no| err{"walker error?"}
  err -->|"broken symlink"| bs["DirEntry::broken_symlink"]
  err -->|"other error"| senderr["send WorkerResult::Error"]
  err -->|ok| norm["DirEntry::normal"]
  bs --> checks["min depth, patterns, extension, type, owner, size, time"]
  norm --> checks
  checks -->|"any fails"| cont
  checks -->|"all pass"| style["compute colour"]
  style --> send["send WorkerResult::Entry"]
  send --> prune{"--prune?"}
  prune -->|yes| skip
  prune -->|no| cont
```

Sources: [src/walk.rs:459-524](repo://src/walk.rs#L459-L524), [src/walk.rs:526-612](repo://src/walk.rs#L526-L612)

The order of the checks matters for speed. `--ignore-contain` is checked first so a directory holding, for example, a `CACHEDIR.TAG` file is skipped with everything below it, and the file type is consulted before the `exists` call to avoid a system call on files. The search roots themselves (depth 0) are never reported. The name match ([[Pattern Matching]]) and the extension check need no metadata, so they run before the type, owner, size and time filters of [[Entry Filters]], which may call `stat`.

Sources: [src/walk.rs:464-484](repo://src/walk.rs#L464-L484), [src/walk.rs:508-591](repo://src/walk.rs#L508-L591), [src/config.rs:134-135](repo://src/config.rs#L134-L135)

When an entry passes and results are printed in colour, `entry.style(ls_colors)` is called on the walker thread so the `LS_COLORS` lookup runs in parallel and the receiver only reads the cached style. With `--prune`, a matching directory is sent and then skipped, so nothing below it is searched.

Sources: [src/walk.rs:593-611](repo://src/walk.rs#L593-L611)

## Errors and broken symlinks

When the walker reports an error, fd checks whether it is a "not found" error on a path that is itself a symlink. That is how a broken symlink shows up when links are followed, and such entries become `DirEntry::broken_symlink` so they can still be listed and filtered as symlinks. Every other error is sent to the receiver as `WorkerResult::Error`, which prints it only with `--show-errors`.

Sources: [src/walk.rs:485-506](repo://src/walk.rs#L485-L506), [src/walk.rs:37-45](repo://src/walk.rs#L37-L45)

## DirEntry

`DirEntry` wraps either an `ignore::DirEntry` or the path of a broken symlink. Its `metadata` and `style` are kept in `OnceCell`s and computed on first use, so the size, time and owner filters share one `stat` call, and an entry that fails the name match never pays for one. A broken symlink reads its metadata with `symlink_metadata` and has no depth, so a `--min-depth` check drops it.

Sources: [src/dir_entry.rs:11-110](repo://src/dir_entry.rs#L11-L110)

Entries compare and sort by path, which the receiver uses to sort buffered results. `DirEntry` implements `lscolors::Colorable`, so `LsColors` can style it from its name, type and metadata; for a broken symlink the name is taken from the last path component by hand.

Sources: [src/dir_entry.rs:116-167](repo://src/dir_entry.rs#L116-L167)

## Batching and backpressure

Sending each entry separately would make every walker thread contend on the channel. `BatchSender` instead collects results in a `Batch`, a shared `Arc<Mutex<Option<Vec<WorkerResult>>>>`. The first item put into a fresh batch sends a clone of the batch handle over the channel; later items are pushed into the same vector, so the receiver may see items added after the handle was sent. A new batch is started when the current one reaches the limit or when the receiver has already taken its contents (the `Option` is `None`).

Sources: [src/walk.rs:47-122](repo://src/walk.rs#L47-L122)

The limit is 256 (`0x100`) entries. With `--exec` on more than one thread it is 1, so every result is a separate message and the job threads share the work evenly. Because the channel is bounded, a walker blocks when the receiver falls behind, which keeps memory use flat.

Sources: [src/walk.rs:449-457](repo://src/walk.rs#L449-L457), [src/walk.rs:636](repo://src/walk.rs#L636-L636)

## Stopping

A walk ends in one of three ways. Normally the walker finishes, the senders are dropped, and the receiver sees the channel disconnect. If the receiver stops first (for `--max-results`, `--quiet` or a write error), it sets `quit_flag`; each closure returns `Quit` on its next entry, and a failed `send` also returns `Quit`. Ctrl-C sets the same flag through the handler installed by `scan`.

Sources: [src/walk.rs:173-181](repo://src/walk.rs#L173-L181), [src/walk.rs:459-462](repo://src/walk.rs#L459-L462), [src/walk.rs:600-604](repo://src/walk.rs#L600-L604)
