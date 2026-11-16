---
title: "Walker and Ignore Rules"
---
## Overview

The walker is the `ignore` crate's parallel directory walk, configured from the `Config` that [[Startup and Configuration]] built. `WorkerState::scan` builds it, starts the receiver on its own thread, and runs the sender threads that visit the tree. This page covers which files the walk is told to skip, and how each sender thread reads the entries it visits. The checks that decide whether an entry is sent are on [[Entry Filters]], and what the receiver does with what is sent is on [[Result Receiver and Ordering]].

Sources: [src/walk.rs:617-653](repo://src/walk.rs#L617-L653)

## Building the walker

`build_walker` creates a `WalkBuilder` rooted at the first search path and maps each `Config` flag onto it. Hidden entries are skipped unless `ignore_hidden` is off. `.fdignore` files are read when `read_fdignore` is set. VCS ignore files (`.gitignore`, the global Git ignore, and `.git/info/exclude`) are read when `read_vcsignore` is set, and `require_git` decides whether a Git repository must be present for them to apply. Symlinks are followed only with `--follow`, and `--max-depth` limits how deep the walk descends.

Sources: [src/walk.rs:347-365](repo://src/walk.rs#L347-L365)

The walk ends with `build_parallel`, which uses the configured thread count. Every sender thread gets its own visitor from the same builder, so the walk is shared across threads by the `ignore` crate.

Sources: [src/walk.rs:402-403](repo://src/walk.rs#L402-L403), [src/walk.rs:444-457](repo://src/walk.rs#L444-L457)

## Ignore files

`.fdignore` is registered as a custom ignore filename. The parent-directory setting applies only when `.fdignore` or the VCS rules are in use, so a search with both turned off never reads ignore files from above the search path.

Sources: [src/walk.rs:367-369](repo://src/walk.rs#L367-L369), [src/walk.rs:356-356](repo://src/walk.rs#L356-L356)

A global ignore file is read from the user's configuration directory, at `fd/ignore` under it, when `read_global_ignore` is set and the file exists. Each `--ignore-file` path is added after it. A malformed pattern in either file prints an error, and a partial parse is accepted silently.

Sources: [src/walk.rs:371-385](repo://src/walk.rs#L371-L385), [src/walk.rs:387-396](repo://src/walk.rs#L387-L396)

Extra search paths after the first are added to the same builder, so one walk covers all of them. The exclude overrides are rooted at the first path only.

Sources: [src/walk.rs:398-400](repo://src/walk.rs#L398-L400)

## Exclude patterns

`--exclude` patterns reach the walk as overrides. `build_overrides` creates an `OverrideBuilder` rooted at the first path and adds each exclude pattern, which `main` has already prefixed with `!`. A malformed pattern is an error, and a set that cannot be built is reported as a mismatch.

Sources: [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/main.rs:380-380](repo://src/main.rs#L380-L380)

## What a sender does with each entry

`spawn_senders` runs one closure for each walker thread. It makes a `BatchSender` for that thread and then handles every entry the walk yields. The closure first stops early if the quit flag is set, so a broken pipe or an interrupt ends every thread quickly.

Sources: [src/walk.rs:443-462](repo://src/walk.rs#L443-L462)

Directories that hold a marker file are skipped whole. Each directory entry is checked against `ignore_contain`, and if any name exists inside it, the walk does not descend into it. The check runs before the filters on [[Entry Filters]], so a cache directory stays out of the results even when its contents match.

Sources: [src/walk.rs:464-479](repo://src/walk.rs#L464-L479), [src/config.rs:134-135](repo://src/config.rs#L134-L135)

The root entry is always skipped, because the search does not report the directory it started in.

Sources: [src/walk.rs:480-483](repo://src/walk.rs#L480-L483)

## Errors and broken symlinks

A `NotFound` error on a path that is a symbolic link is not an error. The sender turns it into a broken-symlink entry, so `--type` filters and the output can still show it. Any other walk error is sent to the receiver as a `WorkerResult::Error`, and the receiver prints it only when `show_filesystem_errors` is set.

Sources: [src/walk.rs:485-506](repo://src/walk.rs#L485-L506), [src/walk.rs:227-231](repo://src/walk.rs#L227-L231)

Entries below `--min-depth` are dropped with no further work, and an entry with no depth (a broken symlink) is dropped too when a minimum depth is set.

Sources: [src/walk.rs:508-512](repo://src/walk.rs#L508-L512)

## Sending and pruning

An entry that passes every filter is added to the thread's batch. `BatchSender::send` starts a new batch whenever the current one is full or has been taken by the receiver, and it puts a batch on the channel as soon as it gets its first item, so the receiver is never waiting for a full batch. The batch size is 256 for ordinary searches and 1 for parallel `--exec`.

Sources: [src/walk.rs:74-122](repo://src/walk.rs#L74-L122), [src/walk.rs:448-457](repo://src/walk.rs#L448-L457)

With `--prune`, the walk does not descend into an entry once it has been sent. Without `--prune`, the walk continues into every directory it visits, whether or not that directory was sent.

Sources: [src/walk.rs:600-611](repo://src/walk.rs#L600-L611)

## Interrupts

When colour is on and no `--exec` command is set, a Ctrl-C handler sets the quit flag and the interrupt flag on the first press. The receiver checks the interrupt flag after each printed line and stops. A second press exits the process at once with the interrupt status. A run that was interrupted reports the interrupt status instead of the receiver's status.

Sources: [src/walk.rs:621-634](repo://src/walk.rs#L621-L634), [src/walk.rs:648-652](repo://src/walk.rs#L648-L652)
