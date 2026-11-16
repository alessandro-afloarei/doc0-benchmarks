---
title: "Directory Walk"
---
## Overview

The walk is the `ignore` crate's parallel walker, configured once in `build_walker` from the `Config` and run by `spawn_senders`. The walker decides which paths exist for fd: which directories it descends into, which files it skips because of ignore rules, and how deep it goes. Each path it yields becomes a `DirEntry`, which is then tested by the name patterns ([[Pattern Matching]]) and the filters ([[Entry Filters]]) inside the same sender closure.

Sources: [src/walk.rs:347-402](repo://src/walk.rs#L347-L402), [src/walk.rs:443-460](repo://src/walk.rs#L443-L460)

## Ignore rules

`build_walker` maps each `Config` flag directly onto a `WalkBuilder` setting. Hidden entries follow `ignore_hidden`. `.fdignore` is read through `add_custom_ignore_filename` when `read_fdignore` is set. The VCS ignore files (`.gitignore`, the global Git excludes and `.git/info/exclude`) follow `read_vcsignore`, and `require_git` means a `.gitignore` is honoured only inside a Git repository unless `--no-require-git` is given. Parent directories' ignore files are read when `read_parent_ignore` and one of the local ignore kinds is active.

Sources: [src/walk.rs:352-368](repo://src/walk.rs#L352-L368)

Two more ignore sources are added by hand. The global file `fd/ignore` under the user's config directory is read when `read_global_ignore` is set, and each `--ignore-file` path is added in turn. A malformed pattern in either is reported as an error, but a partial parse error is accepted silently.

Sources: [src/walk.rs:370-396](repo://src/walk.rs#L370-L396)

`--exclude` patterns are not ignore files. They are turned into an `OverrideBuilder` with a leading `!` each, so they take precedence over every other rule and apply even to files that a `.gitignore` would otherwise allow. A malformed pattern stops the run before the walk begins.

Sources: [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/main.rs:380](repo://src/main.rs#L380)

## Depth and links

`max_depth` goes to the walker, so the walker itself stops descending at that depth. `min_depth` is different: the sender skips any entry shallower than the minimum, but the walk still descends through it. Symbolic links are followed only with `--follow`, and `--one-file-system` restricts the walk to the root's file system.

Sources: [src/walk.rs:361-366](repo://src/walk.rs#L361-L366), [src/walk.rs:508-512](repo://src/walk.rs#L508-L512)

Extra roots after the first are added to the same walker with `builder.add`, so one walk covers all of them and one set of ignore rules applies to all. The first root is the one used to build the override set.

Sources: [src/walk.rs:398-401](repo://src/walk.rs#L398-L401), [src/walk.rs:330-334](repo://src/walk.rs#L330-L334)

## The sender closure

Each walker thread gets its own `BatchSender` and a closure that runs once per entry. The closure runs checks in a fixed order, and most of them skip the entry or the whole subtree.

Sources: [src/walk.rs:443-460](repo://src/walk.rs#L443-L460)

1. A directory that contains one of the `--ignore-contain` names is skipped with its subtree, which is the cache-directory convention.
2. The root directory itself, depth 0, is never reported.
3. A symbolic link whose target is missing becomes a `DirEntry::broken_symlink`, so it can still be listed; any other walker error is sent to the receiver as a `WorkerResult::Error`.
4. Entries shallower than `min_depth` are passed over.
5. Name patterns and then the filters are applied.

Sources: [src/walk.rs:460-482](repo://src/walk.rs#L460-L482), [src/walk.rs:483-505](repo://src/walk.rs#L483-L505), [src/walk.rs:508-512](repo://src/walk.rs#L508-L512)

`--prune` is applied after a match is sent: the closure returns `Skip` so that nothing beneath a reported directory is visited. Setting a quit flag, or a closed channel, makes the closure return `Quit`, which stops all walkers.

Sources: [src/walk.rs:607-613](repo://src/walk.rs#L607-L613), [src/walk.rs:460-464](repo://src/walk.rs#L460-L464)

## DirEntry

`DirEntry` wraps either the walker's `ignore::DirEntry` or a broken symlink's path. Its file type and metadata come from the walker, and metadata is loaded lazily once and cached, so it is read only when a filter or the colouring asks for it. `stripped_path` removes a leading `./` for printing, but keeps it when the remaining path would start with a dash, so that a downstream command does not read the path as an option.

Sources: [src/dir_entry.rs:12-48](repo://src/dir_entry.rs#L12-L48), [src/dir_entry.rs:58-72](repo://src/dir_entry.rs#L58-L72)

Matched entries leave the closure in batches of up to 256, sent over the channel described in [[Result Streaming]]; the order in which the walker threads produce them is not fixed, which is why the receiver sorts only what it has buffered.

Sources: [src/walk.rs:449-456](repo://src/walk.rs#L449-L456), [src/walk.rs:600-603](repo://src/walk.rs#L600-L603), [src/walk.rs:130-150](repo://src/walk.rs#L130-L150)
