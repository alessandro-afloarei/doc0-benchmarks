---
title: "Startup and Configuration"
---
## Overview

Before any directory is read, `run` in `src/main.rs` turns the command line into three things: a list of search paths, a list of compiled regexes, and one immutable `Config`. Everything later in the program ([[Directory Traversal and Ignore Rules]], [[Entry Filters]], [[Result Pipeline and Output]], [[Command Execution]]) reads that `Config` and never looks at the raw arguments again. Errors at this stage are returned through `anyhow` and `main` prints them, then exits with the general error code.

Sources: [src/main.rs:62-112](repo://src/main.rs#L62-L112), [src/config.rs:13-17](repo://src/config.rs#L13-L17)

## Order of startup steps

`run` does its work in a fixed order, and each step can abort the run:

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112)

1. `Opts::parse()` reads the arguments with clap. With the `completions` feature, `--gen-completions` prints completions for a shell and returns before anything else.
2. `set_working_dir` applies `--base-directory`: it must be an existing directory and becomes the process's current directory.
3. `search_paths` resolves where to search; an empty result is the error "No valid search paths given."
4. `ensure_search_pattern_is_not_a_path` rejects path-like patterns (see [[Pattern Matching]]).
5. Every pattern (the `--and` expressions plus the main one) goes through `build_pattern_regex`.
6. `construct_config` builds the `Config` from the options and the pattern strings.
7. The leading-dot guard runs, then each pattern is compiled with `build_regex`.
8. `walk::scan` starts the search.

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112), [src/main.rs:131-147](repo://src/main.rs#L131-L147)

## Search paths

`Opts::search_paths` takes the positional paths if there are any, else the `--search-path` values, else the current directory as `./`. In the first two cases each path must be an existing directory; one that is not is reported as "Search path ... is not a directory." and dropped, and the search goes on with the rest. Each surviving path goes through `normalize_path`:

Sources: [src/cli.rs:696-722](repo://src/cli.rs#L696-L722)

| Condition | Result |
| --- | --- |
| `--absolute-path` set | absolute, normalised path |
| path is `.` | `./`, a workaround for a ripgrep walker issue |
| path is `-` | `./-`, so the walker treats it as a path |
| otherwise | unchanged |

Sources: [src/cli.rs:695-736](repo://src/cli.rs#L695-L736)

Whether any path was given matters later: `strip_cwd_prefix` only applies when none was (`no_search_paths`), because only then do the results start with the `./` that fd added itself.

Sources: [src/cli.rs:738-741](repo://src/cli.rs#L738-L741), [src/cli.rs:765-774](repo://src/cli.rs#L765-L774)

## Deriving the Config

`construct_config` consumes the `Opts`. Most fields copy a flag, but several are derived:

Sources: [src/main.rs:310-392](repo://src/main.rs#L310-L392)

| Setting | How it is derived |
| --- | --- |
| `case_sensitive` | false if `--ignore-case`; otherwise true if `--case-sensitive` or any pattern has an uppercase literal |
| `ignore_hidden` | `!(hidden \|\| rg_alias_ignore)` |
| `read_fdignore`, `read_global_ignore` | off for `--no-ignore`, the alias, or (for the global file) `--no-global-ignore-file` |
| `read_vcsignore` | additionally off for `--no-ignore-vcs` |
| `require_git_to_read_vcsignore` | `!no_require_git` |
| `read_parent_ignore` | `!no_ignore_parent` |
| `max_depth`, `min_depth` | the flag, or `--exact-depth` if the flag is absent |
| `max_results` | `--max-results` when above zero, else 1 for `--max-one-result` |
| `threads` | `--threads` or the default described below |
| `exclude_patterns` | each `--exclude` prefixed with `!` so it acts as an override |
| `full_path_base` | the current directory, only when `--full-path` is set |

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/main.rs:310-392](repo://src/main.rs#L310-L392), [src/cli.rs:743-763](repo://src/cli.rs#L743-L763)

The thread default is the machine's available parallelism, capped at 64 "to limit startup overhead on massively parallel machines", and falls back to one thread if the count cannot be read.

Sources: [src/cli.rs:788-801](repo://src/cli.rs#L788-L801)

`--type` values are folded into one `FileTypes` struct. `executable` also turns on `files`; `empty` alone turns on both files and directories, so that `--type empty` finds empty files and empty directories. How the struct is applied is in [[Entry Filters]].

Sources: [src/main.rs:333-360](repo://src/main.rs#L333-L360), [src/filetypes.rs:6-18](repo://src/filetypes.rs#L6-L18)

Each `--extension` becomes a case-insensitive regex of the form `.\.ext$` with leading dots removed and the extension escaped; the set is compiled into one `RegexSet`.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373)

Size, time and owner constraints are parsed here too, so a bad value fails before the search starts. `--changed-within` and `--changed-before` become `TimeFilter` values, with the message "is not a valid date or duration" on failure. On Unix, `--owner` goes through `OwnerFilter::filter_ignore`, which drops a no-op like `:`. The grammars are in [[Entry Filters]].

Sources: [src/main.rs:266-269](repo://src/main.rs#L266-L269), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

## Colour, hyperlinks and the path separator

Colour is decided once. `--color always` and `never` are taken as given. `auto` enables colour only if ANSI is supported (always on non-Windows; on Windows it is enabled or `TERM` must be set), `NO_COLOR` is unset or empty, and stdout is a terminal. When colour is on, `LsColors::from_env()` is used, falling back to the built-in `DEFAULT_LS_COLORS` string. Hyperlinks in `auto` mode follow the colour decision.

Sources: [src/main.rs:271-297](repo://src/main.rs#L271-L297), [src/main.rs:56-57](repo://src/main.rs#L56-L57)

The path separator comes from `--path-separator`, else from `default_path_separator`, which returns `/` on Windows when `MSYSTEM` is set (MSYS/MSYS2). `actual_path_separator` is that value or the platform default. On Windows, a separator longer than one byte is an error, with a hint that some shells expand `/`.

Sources: [src/main.rs:257-264](repo://src/main.rs#L257-L264), [src/main.rs:234-246](repo://src/main.rs#L234-L246), [src/filesystem.rs:123-136](repo://src/filesystem.rs#L123-L136)

## The command to run

`extract_command` takes the `--exec` / `--exec-batch` command set that clap's custom `Exec` argument parsed (see [[Command Execution]]). If there is none but `--list-details` is set, it builds a batch command around `ls`: `determine_ls_command` uses `ls -l -h -d` with `--color=always` or `never` on Linux. On macOS and the BSDs it prefers GNU `gls` if it runs, else BSD `ls`, adding `-G` for colour except on NetBSD and OpenBSD. On Windows, it needs a GNU `ls` on the path and otherwise errors.

Sources: [src/main.rs:395-410](repo://src/main.rs#L395-L410), [src/main.rs:412-494](repo://src/main.rs#L412-L494)

`has_command` also decides `strip_cwd_prefix`: in `auto` mode the `./` prefix is stripped unless output is null-separated or a command will run. `DirEntry::stripped_path` keeps the original path when stripping would leave a name starting with `-`, so a command never receives something that looks like an option.

Sources: [src/main.rs:390](repo://src/main.rs#L390), [src/dir_entry.rs:56-71](repo://src/dir_entry.rs#L56-L71)
