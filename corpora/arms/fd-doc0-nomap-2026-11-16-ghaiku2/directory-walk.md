---
title: "Directory Walk"
---
## Overview

`scan` runs the search: it builds one parallel walker over the search paths, starts one receiver thread, and lets the walker's threads send the matching entries to it. The walker is the `ignore` crate's `WalkParallel`. `fd` adds its own rules on top of it in the sender closure, which runs once for every entry the walker yields.

Sources: [src/walk.rs:685-687](repo://src/walk.rs#L685-L687), [src/walk.rs:617-650](repo://src/walk.rs#L617-L650)

The two sides are joined by a bounded channel with room for two batches per thread. The bound gives backpressure: when the receiver is slow, the walker threads wait instead of queueing unbounded results.

Sources: [src/walk.rs:636-645](repo://src/walk.rs#L636-L645), [src/walk.rs:443-458](repo://src/walk.rs#L443-L458)

## Building the walker

`build_walker` starts from the first search path and applies the `Config` flags to `WalkBuilder`: hidden entries, the `.fdignore`, parent-directory ignore files, the VCS ignore files, and whether a `.git` directory is needed before VCS ignore files are read. It also sets `follow_links`, `same_file_system` for `--one-file-system` and `max_depth`, and passes the thread count.

Sources: [src/walk.rs:347-365](repo://src/walk.rs#L347-L365), [src/walk.rs:402-403](repo://src/walk.rs#L402-L403)

Some ignore files are added by hand. `.fdignore` is registered as a custom ignore file name, the global ignore file in the `fd` config directory is added when present, and each `--ignore-file` path is added in turn. A malformed pattern in a custom file prints an error, while a partial error is ignored. The remaining search paths are added to the same builder, so one walk covers all of them.

Sources: [src/walk.rs:366-400](repo://src/walk.rs#L366-L400)

The `--exclude` patterns become overrides. Each pattern is prefixed with `!` in `construct_config` and added to an `OverrideBuilder` rooted at the first search path, so an excluded directory is not entered at all. A malformed pattern stops the run with "Malformed exclude pattern".

Sources: [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/main.rs:380](repo://src/main.rs#L380)

## The per-entry checks

The sender closure is the filter chain. It runs in a fixed order, and the first check that fails ends the entry. The order is the cheapest check first: a stop flag, then the directory marker, the root entry, the depth bound, and the name test, which needs no metadata. The metadata checks come after, so a search that rejects an entry by name never reads its metadata.

Sources: [src/walk.rs:443-523](repo://src/walk.rs#L443-L523)

Each directory is checked for the marker files named by `--ignore-contain`. A directory that holds one of them is skipped with `WalkState::Skip`, so its contents are never listed.

Sources: [src/walk.rs:464-478](repo://src/walk.rs#L464-L478), [src/config.rs:134-135](repo://src/config.rs#L134-L135), [src/cli.rs:548-552](repo://src/cli.rs#L548-L552)

The root entry is skipped, and an entry shallower than `--min-depth` is ignored, while it is still traversed.

Sources: [src/walk.rs:480-482](repo://src/walk.rs#L480-L482), [src/walk.rs:508-511](repo://src/walk.rs#L508-L511)

A walk error is forwarded to the receiver as a `WorkerResult::Error`. The one exception is a `NotFound` error on a path that is a symbolic link: it becomes a broken-symlink entry, so the link itself can still be listed.

Sources: [src/walk.rs:483-506](repo://src/walk.rs#L483-L506)

After the name test, the walk applies the remaining filters in order: the extension set, the file types, the owner (Unix only), the size constraints, and the time constraints. Each one returns `WalkState::Continue` to drop the entry. The filters themselves are described in [[Filters]].

Sources: [src/walk.rs:525-590](repo://src/walk.rs#L525-L590)

An entry that passes everything gets its colour computed when output is colourised. It is then sent to the batch sender. The batch sender sends the first entry of each batch on the channel and fills the batch up to its limit, so that the receiver gets one channel operation per batch.

Sources: [src/walk.rs:591-602](repo://src/walk.rs#L591-L602), [src/walk.rs:81-128](repo://src/walk.rs#L81-L128)

## Quitting and pruning

The batch limit is 256 entries. It drops to one entry when `--exec` runs one command per entry on several threads, so the work spreads over the job threads instead of arriving in one batch.

Sources: [src/walk.rs:449-456](repo://src/walk.rs#L449-L456)

`--prune` makes a matching directory return `WalkState::Skip` after it is sent, so the directory is listed but its contents are not searched.

Sources: [src/walk.rs:605-611](repo://src/walk.rs#L605-L611)

The walk stops when the quit flag is set, which happens when the receiver ends early, for example at `--max-results`. A Ctrl-C sets the same flag when colour output is on, and a second Ctrl-C exits the process at once with code 130.

Sources: [src/walk.rs:460-462](repo://src/walk.rs#L460-L462), [src/walk.rs:617-634](repo://src/walk.rs#L617-L634)
