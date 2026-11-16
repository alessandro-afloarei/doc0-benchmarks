---
title: "Ignore Rules and Exclusions"
---
## Overview

Before an entry reaches the pattern match, the walker may already have skipped it: hidden entries, entries named by ignore files, entries matching `--exclude`, and whole directories that hold an `--ignore-contain` marker. Most of these rules are not implemented by fd itself. `WorkerState::build_walker` translates `Config` fields into settings on the `ignore` crate's `WalkBuilder`, the same walker ripgrep uses, and that crate reads the ignore files and prunes the tree. An ignored directory is never entered, so its contents cost nothing.

Sources: [src/walk.rs:347-404](repo://src/walk.rs#L347-L404)

This page maps each flag to the walker setting it controls. The threads that run the walker are on [[Parallel Directory Walk]]; how the flags become `Config` fields is on [[Command-Line Options and Configuration]].

Sources: [src/main.rs:310-322](repo://src/main.rs#L310-L322)

## Flags and walker settings

| Flag | `Config` field | Walker setting |
| --- | --- | --- |
| default (no `-H`) | `ignore_hidden = true` | `hidden(true)`: skip names starting with `.` |
| `-I`/`--no-ignore` | `read_fdignore`, `read_vcsignore`, `read_global_ignore` all false | no `.ignore`, `.fdignore`, git or global ignore files |
| `--no-ignore-vcs` | `read_vcsignore = false` | `git_ignore`, `git_global`, `git_exclude` off |
| `--no-require-git` | `require_git_to_read_vcsignore = false` | `require_git(false)` |
| `--no-ignore-parent` | `read_parent_ignore = false` | `parents(false)` |
| `--no-global-ignore-file` (hidden) | `read_global_ignore = false` | global `fd/ignore` not added |
| `-u`/`--unrestricted` | as `-I` plus `--hidden` | all of the above off |
| `--ignore-file <path>` | `ignore_files` | `add_ignore(path)` |
| `-E`/`--exclude <glob>` | `exclude_patterns` (prefixed `!`) | `overrides(...)` |
| `-L`/`--follow` | `follow_links` | `follow_links(true)` |
| `--one-file-system` | `one_file_system` | `same_file_system(true)` |
| `-d`/`--max-depth` | `max_depth` | `max_depth(n)` |

Sources: [src/main.rs:310-325](repo://src/main.rs#L310-L325), [src/main.rs:380-381](repo://src/main.rs#L380-L381), [src/walk.rs:352-365](repo://src/walk.rs#L352-L365)

## Ignore files

### Per-directory files

With `read_fdignore` on, the walker reads `.ignore` files (`ignore(true)`) and fd adds `.fdignore` as a custom ignore file name. With `read_vcsignore` on it reads `.gitignore`, git's global excludes file and `.git/info/exclude`. By default those git rules apply only inside a git repository; `--no-require-git` applies them anywhere. Parent directories' ignore files are read only when parent reading is on and at least one kind of ignore file is enabled.

Sources: [src/walk.rs:352-369](repo://src/walk.rs#L352-L369), [src/cli.rs:86-104](repo://src/cli.rs#L86-L104)

Ignore files of different kinds combine with the `ignore` crate's precedence. An integration test shows that a `!foo` line in `.fdignore` re-includes a file that an inner `.gitignore` excludes, and that the file stays visible with `--no-ignore-vcs` and `--no-ignore`.

Sources: [tests/tests.rs:860-884](repo://tests/tests.rs#L860-L884)

### The global ignore file

When `read_global_ignore` is on, fd asks `etcetera::choose_base_strategy` for the user's config directory and, if `fd/ignore` exists there, adds it. The README gives the usual locations as `~/.config/fd/ignore` on macOS and Linux and `%APPDATA%\fd\ignore` on Windows.

Sources: [src/walk.rs:371-385](repo://src/walk.rs#L371-L385), [README.md:274-279](repo://README.md#L274-L279)

### Custom ignore files

Each `--ignore-file` path is added with `add_ignore` after the global file. The CLI help states these files have a low precedence. In both cases an `ignore::Error::Partial` result is accepted silently, and any other error is printed as "Malformed pattern in global ignore file" or "custom ignore file" without stopping the search.

Sources: [src/walk.rs:387-396](repo://src/walk.rs#L387-L396), [src/cli.rs:510-518](repo://src/cli.rs#L510-L518)

## Exclude patterns

`--exclude` globs override every other ignore rule. `construct_config` stores each glob with a leading `!`, and `build_overrides` adds them to an `OverrideBuilder` rooted at the first search path. In the `ignore` crate's override syntax a `!` glob means "ignore what matches", so `-E node_modules` drops any entry named `node_modules` and, for a directory, its whole subtree. A glob that does not parse stops fd with "Malformed exclude pattern".

Sources: [src/main.rs:380](repo://src/main.rs#L380-L380), [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/cli.rs:310-324](repo://src/cli.rs#L310-L324)

```bash
fd -H -E .git
fd -E '*.bak'
```

Sources: [README.md:243-261](repo://README.md#L243-L261)

## Directories with a marker file

`--ignore-contain <name>` is fd's own rule, applied in the sender's visitor rather than by the `ignore` crate. For every directory entry, the visitor checks whether `<dir>/<name>` exists for any of the given names and, if so, returns `WalkState::Skip`: the directory and everything under it are left out. The code points to cache directory tags as the use case.

Sources: [src/walk.rs:464-479](repo://src/walk.rs#L464-L479), [src/config.rs:134-135](repo://src/config.rs#L134-L135)

The check runs before the root entry is skipped and before `--min-depth`, so a marker in the search root hides the whole search and a marked directory is pruned even when its own depth is below the minimum. The integration tests pin both orders.

Sources: [tests/tests.rs:2829-2878](repo://tests/tests.rs#L2829-L2878)

## Multiple roots

`build_walker` creates the builder from the first search path and adds the others with `builder.add`, so all roots share one set of ignore settings and one thread pool. The override matcher is likewise rooted at the first path.

Sources: [src/walk.rs:330-334](repo://src/walk.rs#L330-L334), [src/walk.rs:398-403](repo://src/walk.rs#L398-L403)
