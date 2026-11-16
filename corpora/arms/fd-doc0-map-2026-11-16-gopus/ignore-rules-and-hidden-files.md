---
title: "Ignore Rules and Hidden Files"
---
## Overview

By default fd skips hidden entries and anything an ignore file excludes; the README calls these its "sensible (opinionated) defaults". fd does not implement the rules itself: `WorkerState::build_walker` in `src/walk.rs` configures the `ignore` crate's `WalkBuilder` from `Config`, and the walker never yields a skipped entry or descends into a skipped directory. Pattern matching and the other filters only see what survives ([[Pattern Matching]], [[Parallel Directory Walk]]).

Sources: [README.md:8-11](repo://README.md#L8-L11), [src/walk.rs:347-404](repo://src/walk.rs#L347-L404)

`Config` holds the rules as positive booleans that `construct_config` derives from the negative command-line flags, so the walker setup reads `config.read_vcsignore` rather than `!opts.no_ignore_vcs` ([[Command-Line Options and Config]]).

Sources: [src/main.rs:310-322](repo://src/main.rs#L310-L322), [src/config.rs:22-44](repo://src/config.rs#L22-L44)

## Flags and settings

| Config field | Default | Turned off by |
| --- | --- | --- |
| `ignore_hidden` | true | `-H`/`--hidden`, `-u` |
| `read_fdignore` | true | `-I`/`--no-ignore`, `-u` |
| `read_vcsignore` | true | `-I`, `-u`, `--no-ignore-vcs` |
| `require_git_to_read_vcsignore` | true | `--no-require-git` |
| `read_parent_ignore` | true | `--no-ignore-parent` |
| `read_global_ignore` | true | `-I`, `-u`, `--no-global-ignore-file` |
| `follow_links` | false | turned on by `-L`/`--follow` |
| `one_file_system` | false | turned on by `--one-file-system` (`--mount`, `--xdev`) |

Sources: [src/main.rs:310-322](repo://src/main.rs#L310-L322), [src/cli.rs:33-128](repo://src/cli.rs#L33-L128)

`-u`/`--unrestricted` is an alias for `--no-ignore --hidden`, and it overrides the hidden `--ignore` and `--no-hidden` flags, so a later `-u` wins over an earlier opposite flag. Each negative flag has such a hidden opposite, letting a shell alias that sets `-H` or `-I` be cancelled on the command line.

Sources: [src/cli.rs:47-64](repo://src/cli.rs#L47-L64), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128)

## Configuring the walker

`build_walker` maps each setting to a `WalkBuilder` call. Hidden files are entries whose name starts with a dot, as the `--hidden` help states.

Sources: [src/cli.rs:33-45](repo://src/cli.rs#L33-L45), [src/walk.rs:352-365](repo://src/walk.rs#L352-L365)

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

Several consequences follow from this mapping.

Sources: [src/walk.rs:352-365](repo://src/walk.rs#L352-L365)

- `.ignore` files, which the README notes are shared with `rg` and `ag`, are governed by `read_fdignore`, not by the VCS setting.
- `--no-ignore-vcs` turns off `.gitignore`, the global git excludes file and `.git/info/exclude` together, but keeps `.ignore` and `.fdignore`.
- Parent directories are only searched for ignore files when at least one kind of ignore file is being read.
- With `require_git` on, git rules apply only inside a git repository; `--no-require-git` applies them anywhere, as its help describes.
- `--one-file-system` is declared only on Unix and Windows, which is why the code needs no platform check.

Sources: [src/walk.rs:352-365](repo://src/walk.rs#L352-L365), [src/cli.rs:81-97](repo://src/cli.rs#L81-L97), [src/cli.rs:682-688](repo://src/cli.rs#L682-L688), [README.md:271-272](repo://README.md#L271-L272)

## fd's own ignore files

### .fdignore

When `read_fdignore` is set, `build_walker` registers `.fdignore` as a custom ignore file name. The `ignore` crate then reads it in every directory like a `.gitignore`, but it is specific to fd.

Sources: [src/walk.rs:367-369](repo://src/walk.rs#L367-L369), [README.md:263-270](repo://README.md#L263-L270)

### Global ignore file

When `read_global_ignore` is set, fd asks `etcetera::choose_base_strategy` for the platform's config directory and adds `<config dir>/fd/ignore` if it is a file. The README gives the usual locations as `~/.config/fd/ignore` on macOS and Linux and `%APPDATA%\fd\ignore` on Windows, and suggests listing `.git/` there to keep `.git` contents out of `--hidden` searches.

Sources: [src/walk.rs:371-385](repo://src/walk.rs#L371-L385), [README.md:274-279](repo://README.md#L274-L279)

### Custom ignore files

Each `--ignore-file` path is added with `add_ignore`. Its help says these files use `.gitignore` format and "have a low precedence". They are added whether or not `--no-ignore` is set, since `build_walker` does not check a setting before the loop.

Sources: [src/walk.rs:387-396](repo://src/walk.rs#L387-L396), [src/cli.rs:510-518](repo://src/cli.rs#L510-L518)

### Error handling

For both the global and the custom files, an `ignore::Error::Partial` result is accepted silently, and any other error prints "Malformed pattern in global ignore file" or "Malformed pattern in custom ignore file" through `print_error` without stopping the search.

Sources: [src/walk.rs:376-395](repo://src/walk.rs#L376-L395)

## Exclude patterns

`--exclude` globs override all other ignore logic, as their help states. `construct_config` prefixes each glob with `!`, and `build_overrides` adds them to an `OverrideBuilder` rooted at the first search path. In the `ignore` crate's override syntax a `!` glob means "ignore", so excluded entries are skipped even under `-u`. A malformed glob fails the run with "Malformed exclude pattern".

Sources: [src/cli.rs:310-324](repo://src/cli.rs#L310-L324), [src/main.rs:380-380](repo://src/main.rs#L380-L380), [src/walk.rs:330-345](repo://src/walk.rs#L330-L345)

Overrides and ignore files are configured against the first search path only; further search paths are added to the same builder with `builder.add(path)`, so they share one walker and one rule set.

Sources: [src/walk.rs:347-350](repo://src/walk.rs#L347-L350), [src/walk.rs:398-403](repo://src/walk.rs#L398-L403)

## Directories containing a marker

`--ignore-contain NAME` skips every directory that contains an entry called `NAME`; the `Config` comment cites cache directories (CACHEDIR.TAG) as the motivating case. It is not a `WalkBuilder` option: the sender closure checks each directory entry for `entry_path.join(name).exists()` and returns `WalkState::Skip`, which drops the directory and everything under it. The file type is checked first to avoid needless `exists` calls on files.

Sources: [src/cli.rs:550-552](repo://src/cli.rs#L550-L552), [src/config.rs:134-135](repo://src/config.rs#L134-L135), [src/walk.rs:464-479](repo://src/walk.rs#L464-L479)

This check runs before the root-entry skip and before pattern matching, so a search root that contains the marker yields nothing. `--prune`, which also returns `WalkState::Skip`, works differently: it stops descending only into directories that matched, and is described on [[Parallel Directory Walk]].

Sources: [src/walk.rs:464-484](repo://src/walk.rs#L464-L484), [src/walk.rs:606-609](repo://src/walk.rs#L606-L609)

## When a file is still missing

The README's troubleshooting advice follows from these defaults: use `-u` (or `-HI`) to see every file, and remember that, without `--full-path`, the pattern is compared to the file name only.

Sources: [README.md:394-407](repo://README.md#L394-L407)
