---
title: "Command-Line Options and Configuration"
---
## Overview

fd reads its command line once, into the clap-derived struct `Opts`, and turns it into a `Config` before the search starts. `Opts` mirrors what the user typed: flags, their negations, raw strings. `Config` holds what the search needs to know: whether to skip hidden files, which regexes and filters apply, whether to colour output. The walker threads, the receiver and the command runners all read the same `Config` and never change it.

Sources: [src/cli.rs:21-32](repo://src/cli.rs#L21-L32), [src/config.rs:13-60](repo://src/config.rs#L13-L60), [src/config.rs:89-136](repo://src/config.rs#L89-L136)

This page follows that conversion. How patterns become regexes is on [[Pattern Matching]], how the ignore settings drive the walker is on [[Parallel Directory Traversal]], and the metadata filters are on [[Entry Filters]].

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112)

## Startup sequence

`run` performs the steps in a fixed order, and any failure ends the program with an error before the walk begins.

Sources: [src/main.rs:62-73](repo://src/main.rs#L62-L73)

1. `Opts::parse()` parses and validates the arguments with clap.
2. If `--gen-completions` is present, the completion script is printed and nothing else runs.
3. `set_working_dir` changes into `--base-directory` if one was given, failing if it is not a directory.
4. `opts.search_paths()` resolves the roots; if none is valid, fd stops with "No valid search paths given."
5. `ensure_search_pattern_is_not_a_path` rejects patterns containing `/` unless `--full-path` is set.
6. Each pattern is turned into a regex string, then `construct_config` builds the `Config`.
7. `ensure_use_hidden_option_for_leading_dot_pattern` rejects `^\.`-style patterns when hidden files are skipped.
8. The regexes are compiled and `walk::scan` starts the search.

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112), [src/main.rs:131-147](repo://src/main.rs#L131-L147)

Because `--base-directory` is applied before the paths are resolved, relative search paths are resolved against the new directory, and results are shown relative to it.

Sources: [src/cli.rs:612-626](repo://src/cli.rs#L612-L626), [src/main.rs:131-147](repo://src/main.rs#L131-L147)

## How Opts is declared

### Negatable flags

Most boolean flags have a hidden opposite that cancels them: `--no-hidden` for `--hidden`, `--ignore` for `--no-ignore`, `--no-follow` for `--follow`, `--relative-path` for `--absolute-path`, and so on. Each opposite is a `()` field marked `overrides_with` the flag, and the struct sets `args_override_self = true`, so the last occurrence on the command line wins. This lets an alias or wrapper script set a default that the user can still turn off.

Sources: [src/cli.rs:21-64](repo://src/cli.rs#L21-L64), [src/cli.rs:240-253](repo://src/cli.rs#L240-L253)

`-u`/`--unrestricted` is a counting flag (`ArgAction::Count`) that overrides both `--ignore` and `--no-hidden`; `rg_alias_ignore()` reports whether it was given at least once, and `construct_config` treats it as `--hidden --no-ignore` together.

Sources: [src/cli.rs:121-128](repo://src/cli.rs#L121-L128), [src/cli.rs:742-745](repo://src/cli.rs#L742-L745)

### Conflicts and groups

clap enforces the combinations that make no sense. The `execs` group (`--exec`, `--exec-batch`, `--list-details`) conflicts with `--max-results`, `--quiet` and `-1`, because a command runner never stops early. `--glob` conflicts with `--fixed-strings`, `--exact` with both, `--list-details` with `--absolute-path`, `--print0` with `--list-details`, `--prune` with `--size` and `--exact-depth`, and `--batch-size` requires `--exec-batch`.

Sources: [src/cli.rs:28-31](repo://src/cli.rs#L28-L31), [src/cli.rs:152-198](repo://src/cli.rs#L152-L198), [src/cli.rs:326-331](repo://src/cli.rs#L326-L331), [src/cli.rs:496-508](repo://src/cli.rs#L496-L508)

`--exec` and `--exec-batch` cannot use clap's derive API, because each occurrence is a group of values ended by `;`. The `Exec` struct implements `FromArgMatches` and `Args` by hand and builds a `CommandSet` directly; [[Command Execution]] covers what happens next.

Sources: [src/cli.rs:855-880](repo://src/cli.rs#L855-L880)

## Search paths

`search_paths` takes the positional paths, or else the `--search-path` values (the two conflict), or else `./`. A given path that is not an existing directory is reported with `print_error` and dropped, so `fd foo dir missing` still searches `dir`. With no paths at all, fd first checks that the current directory still exists, since `.` always resolves even after the directory was deleted.

Sources: [src/cli.rs:695-721](repo://src/cli.rs#L695-L721), [src/cli.rs:963-971](repo://src/cli.rs#L963-L971), [src/filesystem.rs:38-42](repo://src/filesystem.rs#L38-L42)

`normalize_path` rewrites each root before the walk.

Sources: [src/cli.rs:723-736](repo://src/cli.rs#L723-L736)

| Input | Becomes | Why |
| --- | --- | --- |
| any path with `--absolute-path` | normalized absolute path | results are printed absolute |
| `.` | `./` | works around a ripgrep `ignore` issue |
| `-` | `./-` | so the walker treats it as a path, not stdin |
| anything else | unchanged | |

Sources: [src/cli.rs:723-736](repo://src/cli.rs#L723-L736), [src/filesystem.rs:14-36](repo://src/filesystem.rs#L14-L36)

## Building the Config

### Case and ignore settings

`construct_config` takes `Opts` by value and moves fields out of it. The search is case-sensitive when `--ignore-case` is absent and either `--case-sensitive` is set or any pattern contains an uppercase character. The ignore settings are negations of the flags: `ignore_hidden` is off with `-H` or `-u`; `read_fdignore` is off with `-I` or `-u`; `read_vcsignore` is off with `-I`, `-u` or `--no-ignore-vcs`; `read_global_ignore` is off with those or `--no-global-ignore-file`; `read_parent_ignore` is off with `--no-ignore-parent`.

Sources: [src/main.rs:248-256](repo://src/main.rs#L248-L256), [src/main.rs:310-321](repo://src/main.rs#L310-L321)

### Colours and hyperlinks

`--color` defaults to `auto`. In auto mode output is coloured only when stdout is a terminal, `NO_COLOR` is unset or empty, and, on Windows, ANSI support could be enabled or `TERM` is set. Coloured output loads `LS_COLORS` from the environment, falling back to the built-in `DEFAULT_LS_COLORS` (a molokai theme generated with `vivid`). `--hyperlink` defaults to `never`; given without a value it means `auto`, which follows the colour decision.

Sources: [src/main.rs:265-297](repo://src/main.rs#L265-L297), [src/cli.rs:519-548](repo://src/cli.rs#L519-L548)

### Paths and separators

`--path-separator` takes any string, but on Windows it must be one byte, because some shells expand `/` into a path. When it is not given, `default_path_separator` returns `/` on Windows when `MSYSTEM` is set (MSYS2, Git Bash). `actual_path_separator` always holds a value, falling back to the platform separator, for printing the trailing slash of directories.

Sources: [src/main.rs:234-246](repo://src/main.rs#L234-L246), [src/main.rs:258-264](repo://src/main.rs#L258-L264), [src/filesystem.rs:123-136](repo://src/filesystem.rs#L123-L136)

`strip_cwd_prefix` decides whether the leading `./` is removed from results. It applies only when no search path was given. With `--strip-cwd-prefix=auto` (the default) the prefix is stripped unless `--print0` or a command is in use, because a command could read a name like `-rf` as an option; `always` and `never` force the choice.

Sources: [src/cli.rs:674-680](repo://src/cli.rs#L674-L680), [src/cli.rs:765-773](repo://src/cli.rs#L765-L773), [src/main.rs:388-390](repo://src/main.rs#L388-L390)

### Limits and threads

| Option | Config field | Rule |
| --- | --- | --- |
| `--max-depth`, `--exact-depth` | `max_depth` | `max_depth` or else `exact_depth` |
| `--min-depth`, `--exact-depth` | `min_depth` | `min_depth` or else `exact_depth` |
| `--max-results`, `-1` | `max_results` | a value of 0 means no limit; `-1` means 1 |
| `--threads`/`-j` | `threads` | default: available parallelism, at most 64, at least 1 |
| `--max-buffer-time` (hidden) | `max_buffer_time` | milliseconds, parsed by `parse_millis` |

Sources: [src/cli.rs:747-763](repo://src/cli.rs#L747-L763), [src/cli.rs:788-800](repo://src/cli.rs#L788-L800), [src/cli.rs:959-961](repo://src/cli.rs#L959-L961)

The 64-thread cap limits startup cost on machines with many cores, and a failure to read the core count falls back to one thread.

Sources: [src/cli.rs:788-800](repo://src/cli.rs#L788-L800)

### Filters and commands

`--type` values are folded into one `FileTypes` struct, `--extension` values become a case-insensitive `RegexSet` of `.\.ext$`, `--exclude` globs are stored with a `!` prefix for the walker's override builder, and `--changed-within`/`--changed-before` are parsed by `extract_time_constraints`, which reports an invalid date or duration. [[Entry Filters]] explains each filter.

Sources: [src/main.rs:330-375](repo://src/main.rs#L330-L375), [src/main.rs:376-386](repo://src/main.rs#L376-L386), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

`extract_command` takes the `--exec` or `--exec-batch` command out of `Opts`. When neither was given but `--list-details` was, it synthesises a batch command from `determine_ls_command`: GNU `ls -l -h -d --color=…` on Linux; `gls` if installed, else BSD `ls -l -h -d` with `-G` for colour, on macOS and the BSDs; GNU `ls` on Windows, which is an error if it is missing. `Config::is_printing` is true only when no command was set.

Sources: [src/main.rs:395-494](repo://src/main.rs#L395-L494), [src/config.rs:138-143](repo://src/config.rs#L138-L143)
