---
title: "Ignore Rules and Traversal"
---
## Overview

fd does not read directories itself. `WorkerState::build_walker` in `src/walk.rs` turns the `Config` flags into a `WalkBuilder` from the `ignore` crate and builds a `WalkParallel`, which decides which directories are entered and which entries reach fd's callback at all. Hidden entries, `.gitignore` matches and `--exclude` globs are dropped inside the walker, before any of fd's own checks run. This page explains which rules the walker applies and where they come from; [[Search Patterns and Configuration]] shows how the `Config` flags are derived from options, and [[Parallel Search Pipeline]] covers how the walker's threads hand entries on.

Sources: [src/walk.rs:347-404](repo://src/walk.rs#L347-L404)

A few traversal decisions cannot be expressed through `WalkBuilder` and are made in the per-entry callback instead: `--ignore-contain`, skipping the root itself and `--prune`. They are described at the end of this page.

Sources: [src/walk.rs:459-484](repo://src/walk.rs#L459-L484), [src/walk.rs:606-611](repo://src/walk.rs#L606-L611)

## Walker configuration

`build_walker` roots the builder at the first search path and sets every option from `Config` in one chain:

Sources: [src/walk.rs:352-365](repo://src/walk.rs#L352-L365)

```rust
        let mut builder = WalkBuilder::new(first_path);
        builder
            .hidden(config.ignore_hidden)
            .ignore(config.read_fdignore)
            .parents(config.read_parent_ignore && (config.read_fdignore || config.read_vcsignore))
            .git_ignore(config.read_vcsignore)
            .git_global(config.read_vcsignore)
            .git_exclude(config.read_vcsignore)
            .require_git(config.require_git_to_read_vcsignore)
            .overrides(overrides)
            .follow_links(config.follow_links)
            // No need to check for supported platforms, option is unavailable on unsupported ones
            .same_file_system(config.one_file_system)
            .max_depth(config.max_depth);
```

Sources: [src/walk.rs:352-365](repo://src/walk.rs#L352-L365)

| Builder call | Source option | Effect |
| --- | --- | --- |
| `hidden` | `-H`, `-u` | Skip names starting with `.` unless disabled |
| `ignore` | `-I`, `-u` | Read `.ignore` files |
| `parents` | `--no-ignore-parent` | Also read ignore files in directories above the search root; off when no ignore files are read at all |
| `git_ignore`, `git_global`, `git_exclude` | `-I`, `-u`, `--no-ignore-vcs` | Read `.gitignore`, the user's global git excludes file, and `.git/info/exclude` |
| `require_git` | `--no-require-git` | Apply git rules only inside a git repository (the default) |
| `overrides` | `-E` | Exclude globs, see below |
| `follow_links` | `-L` | Descend into symlinked directories |
| `same_file_system` | `--one-file-system` | Do not cross mount points |
| `max_depth` | `-d`, `--exact-depth` | Stop descending below this depth |

Sources: [src/walk.rs:352-365](repo://src/walk.rs#L352-L365), [src/main.rs:310-327](repo://src/main.rs#L310-L327)

`--one-file-system` is only compiled on Unix and Windows, which is why the builder call needs no platform check. Depth 1 means the direct children of a root; the root entry itself has depth 0.

Sources: [src/cli.rs:682-688](repo://src/cli.rs#L682-L688), [src/config.rs:49-53](repo://src/config.rs#L49-L53)

## Ignore file sources

### .fdignore

When `.ignore` files are read, `build_walker` also registers `.fdignore` as a custom ignore file name with `add_custom_ignore_filename`. It uses `.gitignore` syntax, applies in every directory like `.ignore`, and lets users hide paths from fd without affecting git or other tools.

Sources: [src/walk.rs:367-369](repo://src/walk.rs#L367-L369)

### The global ignore file

Unless `-I`, `-u` or `--no-global-ignore-file` is given, fd looks for a file named `ignore` in an `fd` folder under the user's configuration directory, found with `etcetera::choose_base_strategy()` (typically `~/.config/fd/ignore` on Unix and `%APPDATA%\fd\ignore` on Windows). If the file exists it is added with `add_ignore`. A partly malformed file is accepted silently; any other error is printed as "Malformed pattern in global ignore file" and the search continues without it.

Sources: [src/walk.rs:371-385](repo://src/walk.rs#L371-L385), [README.md:273-278](repo://README.md#L273-L278)

### --ignore-file

Each `--ignore-file <path>` is added the same way, with "Malformed pattern in custom ignore file" for errors. These files have low precedence: rules in `.gitignore`, `.ignore` or `.fdignore` inside the searched tree can override them.

Sources: [src/walk.rs:387-396](repo://src/walk.rs#L387-L396), [src/cli.rs:510-518](repo://src/cli.rs#L510-L518)

## Exclude globs

`--exclude` patterns are applied through the walker's overrides, which take precedence over every ignore file and also over the hidden-file setting. `construct_config` stores each pattern as `!pattern`; in an `OverrideBuilder` a `!` glob means "ignore this", whereas a plain glob would mean "include only this". `build_overrides` roots the overrides at the first search path and adds each pattern, failing with "Malformed exclude pattern" for a bad glob.

Sources: [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/main.rs:380](repo://src/main.rs#L380)

Because exclusion happens in the walker, an excluded directory is never entered, so `fd -E node_modules` does not pay for reading what is below it. The globs use `.gitignore` syntax, so a glob without a `/`, such as `*.bak` or `.git`, matches a name at any depth.

Sources: [src/cli.rs:310-324](repo://src/cli.rs#L310-L324), [README.md:243-262](repo://README.md#L243-L262)

## Several search roots

The builder is created from `paths[0]`, and every further root is added with `builder.add(path)`. All roots share one walker and one set of rules, and the override globs are rooted at the first path. The thread count is applied last, with `builder.threads(config.threads).build_parallel()`.

Sources: [src/walk.rs:398-403](repo://src/walk.rs#L398-L403)

## Decisions in the callback

### Directories marked by a file

`--ignore-contain NAME` skips any directory that contains an entry called `NAME`, for example a `CACHEDIR.TAG` file. In the callback, for each entry whose file type is a directory, fd checks `entry_path.join(name).exists()` for each configured name and returns `WalkState::Skip`, so neither the directory nor anything below it is reported. The file-type check comes first to avoid a filesystem call for ordinary files.

Sources: [src/walk.rs:464-479](repo://src/walk.rs#L464-L479), [src/config.rs:134-135](repo://src/config.rs#L134-L135)

### The root itself

The walker reports each search root as an entry of depth 0. fd returns `WalkState::Continue` for it without sending it on, so a root is never a result.

Sources: [src/walk.rs:480-483](repo://src/walk.rs#L480-L483)

### Minimum depth

`--min-depth` (and the lower half of `--exact-depth`) cannot be pushed into the walker, which still has to descend through shallow directories to reach deeper ones. The callback therefore drops entries shallower than `min_depth`, as well as broken symlinks, which have no known depth. This is the first per-entry check described on [[Entry Filters]].

Sources: [src/walk.rs:508-512](repo://src/walk.rs#L508-L512), [src/dir_entry.rs:98-103](repo://src/dir_entry.rs#L98-L103)

### --prune

With `--prune`, after an entry has passed every filter and been sent, the callback returns `WalkState::Skip`. For a matching directory this stops the walker descending into it, so `fd --prune node_modules` lists each top-level `node_modules` directory but none nested within it. `--prune` conflicts with `--size` and `--exact-depth`.

Sources: [src/walk.rs:600-611](repo://src/walk.rs#L600-L611), [src/cli.rs:326-331](repo://src/cli.rs#L326-L331)

## Symlinks and file systems

Without `-L`, a symlink to a directory is reported as a symlink and not entered. With `-L`, the walker follows it; a link whose target is missing produces a "not found" error from the walker, which the callback turns into a broken-symlink entry so it still appears in results. [[Parallel Search Pipeline]] shows that conversion.

Sources: [src/cli.rs:240-249](repo://src/cli.rs#L240-L249), [src/walk.rs:485-499](repo://src/walk.rs#L485-L499)
