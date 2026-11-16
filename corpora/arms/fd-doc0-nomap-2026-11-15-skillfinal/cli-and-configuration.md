---
title: "Command-Line Options and Configuration"
---
## Overview

fd reads its arguments once, with clap, into the `Opts` struct, and then folds them into a `Config`: one plain struct that the sender threads, the receiver and the command runners all read and never change. Keeping the two apart means flag spellings, aliases and conflicts live in `src/cli.rs`, while every decision the search makes (colors, depth, ignore files, filters) is computed once in `construct_config` in `src/main.rs`.

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112), [src/config.rs:13-20](repo://src/config.rs#L13-L20)

This page follows that conversion. How the patterns become regexes is on [[Pattern Matching]]; what the ignore flags do to the walk is on [[Ignore Rules and Exclusions]]; how each filter decides is on [[Entry Filters]].

Sources: [src/main.rs:89-110](repo://src/main.rs#L89-L110)

## The Opts struct

### Flag conventions

`Opts` derives `clap::Parser`. The command sets `args_override_self = true`, so a flag given twice keeps the last value, and the `execs` group makes `--exec`, `--exec-batch` and `--list-details` conflict with `--max-results`, `--quiet` and `-1`. Most boolean flags have a hidden negation that overrides them: `--no-hidden` overrides `--hidden`, `--ignore` overrides `--no-ignore`, `--no-follow` overrides `--follow`, `--relative-path` overrides `--absolute-path`. Those negations are stored as `()` fields because only the override matters.

Sources: [src/cli.rs:21-68](repo://src/cli.rs#L21-L68), [src/cli.rs:213-253](repo://src/cli.rs#L213-L253)

`-u`/`--unrestricted` is a counting flag (`rg_alias_hidden_ignore`), and `rg_alias_ignore()` reports whether it was given at all. `--case-sensitive` and `--ignore-case` override each other; `--glob` conflicts with `--fixed-strings`, `--regex` overrides `--glob`, and `--exact` conflicts with both `--glob` and `--fixed-strings`.

Sources: [src/cli.rs:122-198](repo://src/cli.rs#L122-L198), [src/cli.rs:742-745](repo://src/cli.rs#L742-L745)

### Positional arguments

The pattern is the first positional argument and defaults to the empty string, which matches everything. Search roots come either from the positional `path` arguments or from repeated `--search-path`; the two conflict. A pattern beginning with `-` must follow `--`.

Sources: [src/cli.rs:628-672](repo://src/cli.rs#L628-L672)

### Exec arguments

clap's derive API cannot group the values of a repeated multi-value option, so `Exec` implements `FromArgMatches` and `Args` by hand. `--exec`/`-x` and `--exec-batch`/`-X` take one or more values up to a `;` terminator, accept values beginning with `-`, and may repeat; `get_occurrences` keeps each occurrence as its own command, which becomes a `CommandSet` through `CommandSet::new` or `CommandSet::new_batch`. A parse error there becomes a clap `InvalidValue` error. [[Command Execution]] covers what happens to the commands.

Sources: [src/cli.rs:855-957](repo://src/cli.rs#L855-L957)

## Opts helpers

### Search paths

`search_paths` uses the positional paths, else `--search-path`, else `./` after checking the current directory still exists. Each given path that is not an existing directory is reported with `print_error` and dropped; `run` fails with "No valid search paths given." only when none remain. `is_existing_directory` avoids `exists()` because `.` always exists, even when the working directory has been deleted.

Sources: [src/cli.rs:695-721](repo://src/cli.rs#L695-L721), [src/main.rs:83-87](repo://src/main.rs#L83-L87), [src/filesystem.rs:38-42](repo://src/filesystem.rs#L38-L42)

`normalize_path` makes the root absolute with `--absolute-path`, rewrites `.` to `./` to work around a ripgrep walker issue, and turns a root named `-` into `./-` so the walker treats it as a path.

Sources: [src/cli.rs:723-736](repo://src/cli.rs#L723-L736)

### Base directory

Before the paths are resolved, `set_working_dir` changes the process working directory to `--base-directory`. Relative search paths and the printed results are then relative to that directory.

Sources: [src/main.rs:131-147](repo://src/main.rs#L131-L147), [src/cli.rs:613-626](repo://src/cli.rs#L613-L626)

### Derived values

| Helper | Returns |
| --- | --- |
| `max_depth()` | `--max-depth`, else `--exact-depth` |
| `min_depth()` | `--min-depth`, else `--exact-depth` |
| `threads()` | `--threads`, else available parallelism capped at 64 (1 if unknown) |
| `max_results()` | `--max-results` when above 0, else 1 for `-1`, else none |
| `strip_cwd_prefix(auto)` | false when roots were given; otherwise `always`/`never`, or the `auto` predicate |

Sources: [src/cli.rs:747-800](repo://src/cli.rs#L747-L800)

## construct_config

### Case and separators

`construct_config` first decides case sensitivity from the flags and the pattern regexes (see [[Pattern Matching]]). The path separator is `--path-separator`, else `default_path_separator()`, which returns `/` on Windows when `MSYSTEM` is set (MSYS/MSYS2). `actual_path_separator` always holds a value, falling back to the platform's main separator. On Windows a separator longer than one byte is refused with a hint that some shells expand `/`.

Sources: [src/main.rs:248-264](repo://src/main.rs#L248-L264), [src/main.rs:234-246](repo://src/main.rs#L234-L246), [src/filesystem.rs:123-136](repo://src/filesystem.rs#L123-L136)

### Colors and hyperlinks

`--color` is `auto` by default. In `auto`, output is colored only when the terminal supports ANSI (on Windows, when enabling ANSI succeeds or `TERM` is set), `NO_COLOR` is unset or empty, and stdout is a terminal. Colored output loads `LS_COLORS` from the environment, or the built-in `DEFAULT_LS_COLORS` theme generated with `vivid`. `--hyperlink` defaults to `never`; given without a value it means `auto`, which follows the color decision.

Sources: [src/main.rs:271-297](repo://src/main.rs#L271-L297), [src/main.rs:56-60](repo://src/main.rs#L56-L60), [src/cli.rs:520-548](repo://src/cli.rs#L520-L548)

### Commands and full path

`extract_command` takes the `--exec` command set, or for `--list-details` builds a batch `ls` command (see [[Command Execution]]). With `--full-path`, the current directory is read once into `full_path_base` so the walker can build absolute paths without asking again for each entry.

Sources: [src/main.rs:298-308](repo://src/main.rs#L298-L308), [src/main.rs:395-410](repo://src/main.rs#L395-L410)

### File types and extensions

Each `--type` value sets a field of `FileTypes`. `executable` also sets `files`, and `empty` alone selects both files and directories. Extensions lose leading dots and become a case-insensitive `RegexSet` of patterns `.\.ext$`, which requires at least one character before the dot. [[Entry Filters]] describes how both are applied.

Sources: [src/main.rs:333-373](repo://src/main.rs#L333-L373)

### The remaining fields

The ignore flags invert into `read_*` fields: `--no-ignore` and `-u` clear `read_fdignore`, `read_vcsignore` and `read_global_ignore`, `--no-ignore-vcs` clears only `read_vcsignore`, and `--hidden` or `-u` clears `ignore_hidden`. Each `--exclude` glob is stored with a `!` prefix. `--changed-within` and `--changed-before` are parsed by `extract_time_constraints`, and an invalid value stops fd with "is not a valid date or duration". `strip_cwd_prefix` uses as its `auto` rule "neither `--print0` nor a command".

Sources: [src/main.rs:310-393](repo://src/main.rs#L310-L393), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

## The Config struct

`Config` holds only resolved values: `Option`s mean "not requested", and no field refers back to `Opts`. `is_printing()` is true when there is no command, and both the walker and the receiver check it to decide whether to compute colors and install the Ctrl-C handler.

Sources: [src/config.rs:138-143](repo://src/config.rs#L138-L143), [src/walk.rs:593-598](repo://src/walk.rs#L593-L598), [src/walk.rs:621-634](repo://src/walk.rs#L621-L634)

| Field group | Fields | Used by |
| --- | --- | --- |
| Matching | `case_sensitive`, `full_path_base` | [[Pattern Matching]] |
| Ignore and traversal | `ignore_hidden`, `read_fdignore`, `read_parent_ignore`, `read_vcsignore`, `require_git_to_read_vcsignore`, `read_global_ignore`, `follow_links`, `one_file_system`, `max_depth`, `exclude_patterns`, `ignore_files`, `ignore_contain`, `threads` | [[Ignore Rules and Exclusions]], [[Parallel Directory Walk]] |
| Filters | `min_depth`, `prune`, `file_types`, `extensions`, `size_constraints`, `time_constraints`, `owner_constraint` | [[Entry Filters]] |
| Receiver | `quiet`, `max_buffer_time`, `max_results`, `show_filesystem_errors` | [[Result Buffering and Ordering]] |
| Output | `ls_colors`, `hyperlink`, `interactive_terminal`, `format`, `null_separator`, `path_separator`, `actual_path_separator`, `strip_cwd_prefix` | [[Output Formatting]] |
| Commands | `command`, `batch_size` | [[Command Execution]] |

Sources: [src/config.rs:16-135](repo://src/config.rs#L16-L135)
