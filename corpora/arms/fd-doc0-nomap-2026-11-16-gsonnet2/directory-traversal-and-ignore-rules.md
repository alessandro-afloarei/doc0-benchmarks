---
title: "Directory Traversal and Ignore Rules"
---
## Overview

`fd` does not walk directories itself. `WorkerState::build_walker` in `src/walk.rs` configures `ignore::WalkBuilder` from the `Config` and builds a `WalkParallel`, which decides which directories to enter and which entries to hand to fd. This page covers that configuration and the few traversal decisions fd makes itself inside the walker callback. Per-entry checks that happen after an entry is yielded are in [[Entry Filters]].

Sources: [src/walk.rs:347-404](repo://src/walk.rs#L347-L404), [src/walk.rs:443-460](repo://src/walk.rs#L443-L460)

## Walker settings

`build_walker` starts at the first search path and adds the remaining paths with `builder.add`. The settings come straight from `Config` fields, whose derivation is in [[Startup and Configuration]]:

Sources: [src/walk.rs:347-353](repo://src/walk.rs#L347-L353), [src/walk.rs:398-400](repo://src/walk.rs#L398-L400)

| Walker setting | Config field | Effect |
| --- | --- | --- |
| `hidden` | `ignore_hidden` | skip dot files and directories |
| `ignore` | `read_fdignore` | honour `.ignore` files |
| `git_ignore`, `git_global`, `git_exclude` | `read_vcsignore` | honour `.gitignore`, the global git ignore and `.git/info/exclude` |
| `require_git` | `require_git_to_read_vcsignore` | read `.gitignore` only inside a git repository |
| `parents` | `read_parent_ignore` and (`read_fdignore` or `read_vcsignore`) | also read ignore files from parent directories |
| `follow_links` | `follow_links` | follow symlinks |
| `same_file_system` | `one_file_system` | stay on the starting filesystem |
| `max_depth` | `max_depth` | limit recursion |
| `threads` | `threads` | size of the walker pool |

Sources: [src/walk.rs:347-365](repo://src/walk.rs#L347-L365), [src/walk.rs:398-403](repo://src/walk.rs#L398-L403)

## Ignore files

fd layers its own ignore sources on top of the walker's built-in ones. Each is added only when its `Config` flag allows it:

Sources: [src/walk.rs:367-371](repo://src/walk.rs#L367-L371)

1. `.fdignore`: added with `add_custom_ignore_filename` when `read_fdignore` is true. It is read in every directory, like a `.gitignore`.
2. The global ignore file: when `read_global_ignore` is true and `etcetera::choose_base_strategy` finds the user's base directories, fd looks for `fd/ignore` under the config directory and adds it if the file exists.
3. Custom files: each `--ignore-file` path is added with `add_ignore`.

Sources: [src/walk.rs:367-396](repo://src/walk.rs#L367-L396)

Adding a global or custom ignore file can report an error. `ignore::Error::Partial` (some lines failed to parse) is silently accepted; any other error is printed as "Malformed pattern in global ignore file" or "... custom ignore file" and the search continues.

Sources: [src/walk.rs:375-396](repo://src/walk.rs#L375-L396)

## Excludes as overrides

Each `--exclude` pattern reaches the `Config` already prefixed with `!`, and `build_overrides` adds them to an `OverrideBuilder` rooted at the first search path. In the ignore crate's override syntax a `!` pattern marks matches as ignored, so excludes behave like ignore rules that cannot be turned off by the ignore flags. A bad pattern fails the run with "Malformed exclude pattern".

Sources: [src/main.rs:380](repo://src/main.rs#L380), [src/walk.rs:330-345](repo://src/walk.rs#L330-L345)

## Decisions inside the walker callback

The walker yields each entry to the closure built in `spawn_senders`. Before any pattern matching, three traversal decisions are made there:

Sources: [src/walk.rs:443-463](repo://src/walk.rs#L443-L463)

- **Stop flag.** If `quit_flag` is set, the callback returns `WalkState::Quit`, which ends the whole parallel walk. This is how `--max-results`, `--quiet` and Ctrl-C stop the search; see [[Result Pipeline and Output]].
- **`--ignore-contain`.** For a directory, fd checks whether any of the configured file names exists inside it (for example a `CACHEDIR.TAG` file, as the config comment suggests). If so, it returns `WalkState::Skip` and the directory is not entered. The file type is checked first so files cost no extra syscall.
- **Root entry.** An entry at depth 0, the search path itself, is skipped with `Continue` so it is never reported.

Sources: [src/walk.rs:459-484](repo://src/walk.rs#L459-L484), [src/config.rs:134-135](repo://src/config.rs#L134-L135)

After all filters pass and the entry has been sent, `--prune` returns `WalkState::Skip`. A matching directory is therefore reported but not descended into.

Sources: [src/walk.rs:600-611](repo://src/walk.rs#L600-L611)

## Errors and broken symlinks

The walker can yield an error instead of an entry. The callback converts one case: an error with a path whose underlying I/O error is `NotFound` but for which `symlink_metadata` says the path is a symlink. That is a dangling symlink, and it becomes `DirEntry::broken_symlink(path)` so it can still be found, for example with `--type symlink`. For such an entry `depth()` is `None`, and its file type and metadata come from `symlink_metadata`. Any other error is sent to the receiver as `WorkerResult::Error` and printed only with `--show-errors`.

Sources: [src/walk.rs:485-506](repo://src/walk.rs#L485-L506), [src/dir_entry.rs:11-40](repo://src/dir_entry.rs#L11-L40), [src/dir_entry.rs:82-103](repo://src/dir_entry.rs#L82-L103)

Because a broken symlink has no depth, the `--min-depth` check treats it as too shallow: `entry.depth().is_none_or(|d| d < min_depth)` is true, so it is skipped when a minimum depth is set.

Sources: [src/walk.rs:508-512](repo://src/walk.rs#L508-L512)

## Threads and shutdown

The walker runs with `config.threads` threads, and `walker.run` calls the setup closure once per thread, so each thread gets its own `BatchSender`. When a send fails because the receiver is gone, the callback returns `WalkState::Quit`.

Sources: [src/walk.rs:402-402](repo://src/walk.rs#L402-L402), [src/walk.rs:443-457](repo://src/walk.rs#L443-L457), [src/walk.rs:600-604](repo://src/walk.rs#L600-L604)
