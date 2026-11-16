---
title: "Hidden Files, Ignore Rules and Exclusions"
---
## Overview

By default fd shows neither hidden entries nor anything a `.gitignore`, `.ignore` or `.fdignore` file excludes. These rules are not applied by fd's own code: `WorkerState::build_walker` translates a handful of `Config` booleans into settings on `ignore::WalkBuilder`, and the `ignore` crate never yields an excluded entry, nor descends into an excluded directory. The sender closure only ever sees what survived. fd adds one rule of its own, `--ignore-contain`, which the sender closure checks for each directory.

Sources: [src/walk.rs:347-404](repo://src/walk.rs#L347-L404), [src/walk.rs:464-479](repo://src/walk.rs#L464-L479)

This page lists which flags feed which settings and in what order the rule sources are added. The walk that consumes the walker is on [[Parallel Directory Walk]]; the filters that run on yielded entries, such as `--type` and `--size`, are on [[Entry Filters]].

Sources: [src/walk.rs:616-653](repo://src/walk.rs#L616-L653)

## From flags to Config

`construct_config` folds the ignore flags into six booleans. `-u`/`--unrestricted` is counted (so ripgrep's `-uu` is accepted) and stands for `--no-ignore --hidden` through `rg_alias_ignore()`.

Sources: [src/main.rs:310-320](repo://src/main.rs#L310-L320), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128), [src/cli.rs:742-745](repo://src/cli.rs#L742-L745)

| Config field | False when | Opposite flag |
| --- | --- | --- |
| `ignore_hidden` | `-H`/`--hidden` or `-u` | `--no-hidden` |
| `read_fdignore` | `-I`/`--no-ignore` or `-u` | `--ignore` |
| `read_vcsignore` | `-I`, `-u` or `--no-ignore-vcs` | `--ignore-vcs` |
| `require_git_to_read_vcsignore` | `--no-require-git` | `--require-git` |
| `read_parent_ignore` | `--no-ignore-parent` | `--ignore-parent` |
| `read_global_ignore` | `-I`, `-u` or `--no-global-ignore-file` | none |

Sources: [src/main.rs:313-320](repo://src/main.rs#L313-L320), [src/cli.rs:33-120](repo://src/cli.rs#L33-L120)

`--exclude` values are prefixed with `!` and kept in `exclude_patterns`; `--ignore-file` paths go to `ignore_files`, and `--ignore-contain` names to `ignore_contain`, all unchanged.

Sources: [src/main.rs:380-381](repo://src/main.rs#L380-L381), [src/main.rs:391](repo://src/main.rs#L391)

## Configuring the walker

`build_walker` starts the `WalkBuilder` at the first search path and sets every rule before adding the other roots.

Sources: [src/walk.rs:347-365](repo://src/walk.rs#L347-L365)

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

- **Hidden entries.** A name starting with `.` is hidden. Rules from ignore files still apply to hidden entries that `-H` reveals.
- **`.ignore` and `.fdignore`.** `read_fdignore` turns on the `ignore` crate's `.ignore` support and registers `.fdignore` as an extra per-directory ignore file name.
- **Git rules.** `read_vcsignore` turns on `.gitignore`, the global gitignore and `.git/info/exclude` together. With `require_git` (the default) they apply only inside a Git repository.
- **Parent directories.** Ignore files above the search root are read only when parent reading is on and at least one kind of ignore file is enabled.

Sources: [src/walk.rs:352-369](repo://src/walk.rs#L352-L369), [src/cli.rs:33-38](repo://src/cli.rs#L33-L38), [src/cli.rs:81-89](repo://src/cli.rs#L81-L89), [src/cli.rs:103-105](repo://src/cli.rs#L103-L105)

The integration tests show the Git requirement: after the test tree's `.git` directory is removed, `gitignored.foo` shows up again, `--no-require-git` hides it again, and a later `--require-git` undoes that.

Sources: [tests/tests.rs:886-940](repo://tests/tests.rs#L886-L940)

## Extra ignore files

After the per-directory rules, `build_walker` adds two kinds of standalone ignore files with `add_ignore`.

Sources: [src/walk.rs:367-396](repo://src/walk.rs#L367-L396)

The global ignore file is `fd/ignore` under the platform's configuration directory, found with `etcetera::choose_base_strategy()`. It is read only when `read_global_ignore` is true and the file exists. The test harness points `XDG_CONFIG_HOME` at a temporary directory to exercise it, and checks that `-u`, `--no-ignore` and `--no-global-ignore-file` each disable it.

Sources: [src/walk.rs:371-385](repo://src/walk.rs#L371-L385), [tests/testenv/mod.rs:65-73](repo://tests/testenv/mod.rs#L65-L73), [tests/testenv/mod.rs:300-306](repo://tests/testenv/mod.rs#L300-L306), [tests/tests.rs:1013-1052](repo://tests/tests.rs#L1013-L1052)

Each `--ignore-file` path is added next, in `.gitignore` format and with low precedence. Its loop is not gated by any `read_*` flag, so a custom ignore file still applies under `--no-ignore`.

Sources: [src/walk.rs:387-396](repo://src/walk.rs#L387-L396), [src/cli.rs:510-518](repo://src/cli.rs#L510-L518), [tests/tests.rs:975-992](repo://tests/tests.rs#L975-L992)

For both, a partial error (some lines unparseable) is dropped without a message; any other error prints "Malformed pattern in global ignore file" or "… custom ignore file" and the search continues.

Sources: [src/walk.rs:376-395](repo://src/walk.rs#L376-L395)

## Precedence between rule sources

Rules from different sources combine the way the `ignore` crate combines them, and a whitelist line in one file can re-include what another excluded. The tests pin one case: a `!foo` line in the root `.fdignore` keeps `inner/foo` visible even though `inner/.gitignore` lists `foo`, with or without `--no-ignore-vcs`. They also show `--no-ignore-vcs` keeping `.fdignore` rules, including one in a parent directory of the search root.

Sources: [tests/tests.rs:860-884](repo://tests/tests.rs#L860-L884), [tests/tests.rs:959-973](repo://tests/tests.rs#L959-L973)

## Exclude patterns

`--exclude` (`-E`) takes globs that "override any other ignore logic". `build_overrides` makes an `OverrideBuilder` rooted at the first search path and adds every stored pattern, each already prefixed with `!`. In the `ignore` crate's override syntax a plain glob whitelists and a `!` glob excludes, so the prefix turns each value into an exclusion. A malformed glob stops fd with "Malformed exclude pattern".

Sources: [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/cli.rs:310-324](repo://src/cli.rs#L310-L324), [src/main.rs:380](repo://src/main.rs#L380)

An excluded directory is not descended into. The tests show `--exclude one/two/` removing everything below `one/two`, and `--exclude 'one/**/*.foo'` removing the `.foo` files under `one` while keeping the directories.

Sources: [tests/tests.rs:1650-1698](repo://tests/tests.rs#L1650-L1698)

## Directories marked by a file inside them

`--ignore-contain <name>` skips any directory that contains an entry called `<name>`, the convention used by `CACHEDIR.TAG` cache directories. The check runs in the sender closure for each successfully read entry whose type is a directory: it tests `entry_path.join(name).exists()` for each configured name and returns `WalkState::Skip`, so neither the directory nor its contents are reported. Checking the file type first avoids the extra filesystem calls for plain files.

Sources: [src/walk.rs:459-479](repo://src/walk.rs#L459-L479), [src/cli.rs:550-552](repo://src/cli.rs#L550-L552), [src/config.rs:134-135](repo://src/config.rs#L134-L135)

The check runs before the root is skipped and before `--min-depth`, so it wins over both. A search root that itself contains `CACHEDIR.TAG` returns nothing, and with `--min-depth=2` a marked directory's deeper contents are still hidden.

Sources: [src/walk.rs:464-484](repo://src/walk.rs#L464-L484), [tests/tests.rs:2829-2878](repo://tests/tests.rs#L2829-L2878)
