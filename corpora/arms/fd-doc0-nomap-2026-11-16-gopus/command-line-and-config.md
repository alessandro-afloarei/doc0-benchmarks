---
title: "Command-Line Options and Config"
---
## Overview

fd reads its options once, at start-up, and never looks at the command line again. `Opts` in `src/cli.rs` is a clap `Parser` struct whose doc comments are the `--help` text. `run` parses it, resolves the search paths, and `construct_config` in `src/main.rs` converts it into a `Config`: a plain struct of resolved values (booleans, compiled regex sets, parsed filters, an optional command) that the walker, the printer and the command runner all borrow read-only. Nothing after `construct_config` asks whether a flag was given; it asks what the `Config` says.

Sources: [src/cli.rs:21-32](repo://src/cli.rs#L21-L32), [src/main.rs:75-112](repo://src/main.rs#L75-L112), [src/config.rs:13-30](repo://src/config.rs#L13-L30), [src/config.rs:138-143](repo://src/config.rs#L138-L143)

This page follows that conversion. How the patterns become regexes is on [[Pattern Matching]], what the ignore flags switch off is on [[Hidden Files, Ignore Rules and Exclusions]], and the `--type`, `--size`, `--changed-*` and `--owner` filters are on [[Entry Filters]].

Sources: [src/main.rs:248-270](repo://src/main.rs#L248-L270)

## The Opts parser

The command is declared with `args_override_self = true`, so repeating a flag keeps the last value instead of failing. Most boolean flags have a hidden opposite (`--no-hidden`, `--ignore`, `--ignore-vcs`, `--require-git`, `--ignore-parent`, `--relative-path`, `--no-follow`) declared as a unit field with `overrides_with`, which lets an alias or shell function turn a flag on and a later argument turn it back off.

Sources: [src/cli.rs:21-64](repo://src/cli.rs#L21-L64), [src/cli.rs:222-253](repo://src/cli.rs#L222-L253)

The `execs` argument group ties `--exec`, `--exec-batch` and `--list-details` together and makes them conflict with `--max-results`, `--quiet` and `-1`: those three stop the search early, which has no meaning while results feed a command. Other pairs refuse each other directly: `--glob` with `--fixed-strings`, `--exact` with both, `--list-details` with `--absolute-path`, `--print0` and `--format`, `--prune` with `--size` and `--exact-depth`, `--quiet` with `--max-results`, and `--search-path` with positional paths.

Sources: [src/cli.rs:29-30](repo://src/cli.rs#L29-L30), [src/cli.rs:154-198](repo://src/cli.rs#L154-L198), [src/cli.rs:231-238](repo://src/cli.rs#L231-L238), [src/cli.rs:268-276](repo://src/cli.rs#L268-L276), [src/cli.rs:326-331](repo://src/cli.rs#L326-L331), [src/cli.rs:481-487](repo://src/cli.rs#L481-L487), [src/cli.rs:592-601](repo://src/cli.rs#L592-L601), [src/cli.rs:664-672](repo://src/cli.rs#L664-L672)

clap's derive API cannot collect grouped values, so `--exec` and `--exec-batch` are added by hand through the `Exec` type, which implements `clap::Args` and `FromArgMatches`. Both take one or more values, accept values starting with a hyphen, and end at a `;`; each occurrence becomes one command in a `CommandSet` (see [[Command Execution]]).

Sources: [src/cli.rs:855-957](repo://src/cli.rs#L855-L957)

## Search paths and the working directory

`set_working_dir` runs before anything else reads a path: when `--base-directory` is given it must be an existing directory, and fd changes its own current directory to it, so positional paths and `--search-path` values resolve relative to it.

Sources: [src/main.rs:131-147](repo://src/main.rs#L131-L147), [src/cli.rs:613-626](repo://src/cli.rs#L613-L626)

`search_paths` uses the positional paths, else the `--search-path` values, else `./`. A given path that is not a directory is reported with `print_error` and dropped; if none survive, `run` stops with "No valid search paths given." When fd falls back to `./`, it first checks that the current directory still exists, since `.` resolves even after the directory has been deleted.

Sources: [src/cli.rs:696-721](repo://src/cli.rs#L696-L721), [src/main.rs:84-87](repo://src/main.rs#L84-L87), [src/cli.rs:963-971](repo://src/cli.rs#L963-L971), [src/filesystem.rs:38-42](repo://src/filesystem.rs#L38-L42)

`normalize_path` then rewrites each root. With `--absolute-path` it becomes an absolute, normalized path. A bare `.` becomes `./` to work around a ripgrep walker issue, and a root named `-` becomes `./-` so the walker treats it as a path.

Sources: [src/cli.rs:723-736](repo://src/cli.rs#L723-L736)

## Derived option values

A few `Opts` methods combine several flags into one value before `Config` sees them.

Sources: [src/cli.rs:742-763](repo://src/cli.rs#L742-L763)

| Method | Result |
| --- | --- |
| `max_depth()` | `--max-depth`, else `--exact-depth` |
| `min_depth()` | `--min-depth`, else `--exact-depth` |
| `threads()` | `--threads`, else available parallelism capped at 64, or 1 if it is unknown |
| `max_results()` | `--max-results` when above 0, else 1 for `-1`, else none |
| `strip_cwd_prefix(auto)` | false when any search path was given; otherwise `--strip-cwd-prefix` (`always` when given without a value), with `auto` deciding by default |
| `rg_alias_ignore()` | true when `-u`/`--unrestricted` was given at least once |

Sources: [src/cli.rs:742-800](repo://src/cli.rs#L742-L800)

`construct_config` passes `!(null_separator || has_command)` as the `auto` predicate, so the leading `./` is stripped for normal printing and kept for `--print0`, `--exec` and `--exec-batch`, where it stops a name like `-rf` from being read as an option.

Sources: [src/main.rs:390](repo://src/main.rs#L390), [src/cli.rs:674-680](repo://src/cli.rs#L674-L680)

## Building the Config

### Case, separators and filters

`construct_config` takes `Opts` by value and moves or derives each field. The order matters in one place: case sensitivity is decided from the regex source of every pattern, so it runs after `build_pattern_regex` and before the regexes are compiled (see [[Pattern Matching]]).

Sources: [src/main.rs:248-256](repo://src/main.rs#L248-L256), [src/main.rs:94-109](repo://src/main.rs#L94-L109)

The path separator is `--path-separator` if given, else `/` on Windows when the `MSYSTEM` variable is set (MSYS and MSYS2 shells), else none. `actual_path_separator` always holds a concrete string, falling back to the platform separator. On Windows a separator longer than one byte is refused, with a hint that some shells expand `/`.

Sources: [src/main.rs:257-264](repo://src/main.rs#L257-L264), [src/main.rs:234-246](repo://src/main.rs#L234-L246), [src/filesystem.rs:123-136](repo://src/filesystem.rs#L123-L136)

`--size` values are already `SizeFilter`s (clap calls `SizeFilter::from_string`), and `--owner` is already an `OwnerFilter`; an owner filter that checks neither user nor group is dropped. `--changed-within` and `--changed-before` are parsed here into `TimeFilter`s, and an unparseable value stops fd with an error.

Sources: [src/main.rs:266-269](repo://src/main.rs#L266-L269), [src/main.rs:496-519](repo://src/main.rs#L496-L519), [src/cli.rs:412-417](repo://src/cli.rs#L412-L417), [src/cli.rs:469-473](repo://src/cli.rs#L469-L473)

### Colour and hyperlinks

`--color auto` (the default) colours output only when stdout is a terminal, `NO_COLOR` is unset or empty, and the terminal supports ANSI codes; on Windows that last check enables ANSI support or accepts any `TERM` value. With colour on, `ls_colors` comes from `LS_COLORS`, or from the built-in `DEFAULT_LS_COLORS` table when the variable is unset. A `None` `ls_colors` is how the rest of fd knows output is uncoloured.

Sources: [src/main.rs:271-292](repo://src/main.rs#L271-L292), [src/main.rs:56-60](repo://src/main.rs#L56-L60)

`--hyperlink` defaults to `never`; given without a value it means `auto`, which follows the colour decision. `interactive_terminal` is stored separately because sanitization depends on whether stdout is a terminal, not on colour (see [[Output and Buffering]]).

Sources: [src/main.rs:293-297](repo://src/main.rs#L293-L297), [src/cli.rs:532-548](repo://src/cli.rs#L532-L548), [src/main.rs:277](repo://src/main.rs#L277)

### The command and --list-details

`extract_command` takes the `CommandSet` parsed from `--exec`/`--exec-batch`. When there is none and `-l`/`--list-details` is set, it builds a batch command running `ls` instead. `determine_ls_command` uses GNU `ls -l -h -d --color=…` on most Unix systems; on macOS and the BSDs it uses `gls` when it exists, else BSD `ls -l -h -d`, adding `-G` for colour except on NetBSD and OpenBSD. On Windows it needs GNU `ls` on the path, and on other platforms `--list-details` is an error. Short options are used on purpose so BusyBox `ls` works.

Sources: [src/main.rs:395-494](repo://src/main.rs#L395-L494)

### --full-path base

When `--full-path` is set, `construct_config` reads the current directory once into `full_path_base`, failing if it cannot be determined. The walker joins each relative entry path onto it instead of asking the OS for the working directory per entry.

Sources: [src/main.rs:301-308](repo://src/main.rs#L301-L308), [src/config.rs:18-20](repo://src/config.rs#L18-L20)

## Config fields

| Group | Fields | Read by |
| --- | --- | --- |
| Matching | `case_sensitive`, `full_path_base`, `extensions` | [[Pattern Matching]] |
| Ignore rules | `ignore_hidden`, `read_fdignore`, `read_vcsignore`, `require_git_to_read_vcsignore`, `read_parent_ignore`, `read_global_ignore`, `exclude_patterns`, `ignore_files`, `ignore_contain` | [[Hidden Files, Ignore Rules and Exclusions]] |
| Traversal | `follow_links`, `one_file_system`, `max_depth`, `min_depth`, `prune`, `threads` | [[Parallel Directory Walk]] |
| Filters | `file_types`, `size_constraints`, `time_constraints`, `owner_constraint` (Unix) | [[Entry Filters]] |
| Output | `null_separator`, `quiet`, `max_buffer_time`, `ls_colors`, `hyperlink`, `interactive_terminal`, `format`, `path_separator`, `actual_path_separator`, `max_results`, `strip_cwd_prefix`, `show_filesystem_errors` | [[Output and Buffering]] |
| Commands | `command`, `batch_size` | [[Command Execution]] |

Sources: [src/config.rs:13-75](repo://src/config.rs#L13-L75), [src/config.rs:76-136](repo://src/config.rs#L76-L136), [src/main.rs:310-392](repo://src/main.rs#L310-L392)

`Config::is_printing` is true when there is no command; the walker uses it to decide whether to install the Ctrl-C handler and whether to compute colour styles.

Sources: [src/config.rs:138-143](repo://src/config.rs#L138-L143), [src/walk.rs:593-598](repo://src/walk.rs#L593-L598), [src/walk.rs:621-634](repo://src/walk.rs#L621-L634)
