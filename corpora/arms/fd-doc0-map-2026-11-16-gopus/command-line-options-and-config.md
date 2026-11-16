---
title: "Command-Line Options and Config"
---
## Overview

Every fd run starts by turning argv into two structures. `Opts` in `src/cli.rs` is the clap-derived view of the command line, with the flags as the user typed them. `Config` in `src/config.rs` is the resolved, immutable configuration the walker, filters, printer and command runner read; it holds positive settings (`ignore_hidden`, `read_vcsignore`) and pre-built objects (`LsColors`, a `RegexSet` of extensions, a `CommandSet`) instead of raw flags. `construct_config` in `src/main.rs` performs the conversion, after `run` has resolved search paths and pattern strings.

Sources: [src/cli.rs:21-32](repo://src/cli.rs#L21-L32), [src/config.rs:13-71](repo://src/config.rs#L13-L71), [src/config.rs:72-136](repo://src/config.rs#L72-L136), [src/main.rs:75-112](repo://src/main.rs#L75-L112)

This page follows that conversion. How the pattern strings become regexes is in [[Pattern Matching]], what the ignore settings do to the walk is in [[Ignore Rules and Hidden Files]], and how a `CommandSet` runs is in [[Command Execution]].

Sources: [src/main.rs:94-109](repo://src/main.rs#L94-L109)

## Parsing with clap

`Opts` derives `clap::Parser`. The command attributes set `args_override_self = true`, so repeating a flag keeps the last value instead of erroring, and put `--exec`, `--exec-batch` and `--list-details` in an `execs` group that conflicts with `--max-results`, `--quiet` and `-1`, because those stop the search before every result reaches a command.

Sources: [src/cli.rs:21-31](repo://src/cli.rs#L21-L31)

Most boolean flags have a hidden opposite that overrides them, so a flag set in a shell alias can be cancelled later on the same command line: `--no-hidden` overrides `--hidden`, `--ignore` overrides `--no-ignore`, `--ignore-vcs`, `--require-git`, `--ignore-parent`, `--relative-path` and `--no-follow` work the same way. These opposite fields have type `()` because only their override effect matters.

Sources: [src/cli.rs:39-116](repo://src/cli.rs#L39-L116), [src/cli.rs:223-253](repo://src/cli.rs#L223-L253)

`-u`/`--unrestricted` is stored as a counter in `rg_alias_hidden_ignore`, named after ripgrep's alias; `rg_alias_ignore()` returns true when it was given at least once. Case flags `-s` and `-i` override each other, `--glob` conflicts with `--fixed-strings`, and `--exact` conflicts with both.

Sources: [src/cli.rs:122-198](repo://src/cli.rs#L122-L198), [src/cli.rs:742-745](repo://src/cli.rs#L742-L745)

Some options are parsed into domain types by clap itself: `--size` values go through `SizeFilter::from_string` and `--owner` through `OwnerFilter::from_string` (both on [[Entry Filters]]), `--threads` must parse as `NonZeroUsize`, and the hidden `--max-buffer-time` is read as milliseconds by `parse_millis`. `--changed-within` and `--changed-before` stay strings until `construct_config` parses them.

Sources: [src/cli.rs:412-473](repo://src/cli.rs#L412-L473), [src/cli.rs:554-564](repo://src/cli.rs#L554-L564), [src/cli.rs:959-961](repo://src/cli.rs#L959-L961)

## Exec arguments

`--exec` and `--exec-batch` take a whole command template, possibly several times, which clap's derive API cannot express as grouped values. `Exec` therefore implements `clap::Args` and `clap::FromArgMatches` by hand. `augment_args` declares both arguments with `num_args(1..)`, `allow_hyphen_values(true)` and `value_terminator(";")`, so everything after `-x` up to an optional `;` belongs to the command.

Sources: [src/cli.rs:855-957](repo://src/cli.rs#L855-L957)

`from_arg_matches` reads the occurrences of `exec` (one `Vec<String>` per `-x`) and builds `CommandSet::new`, or else builds `CommandSet::new_batch` from `exec_batch`. A template error, such as an empty command, becomes a clap `InvalidValue` error, so it is reported like any other bad argument.

Sources: [src/cli.rs:861-880](repo://src/cli.rs#L861-L880)

## Search paths and working directory

Before the paths are read, `set_working_dir` changes into `--base-directory` when one is given, failing if it is not a directory. `Opts::search_paths` then prefers positional paths, then `--search-path` values (the two conflict), and otherwise uses `./` after checking that the current directory still exists. A given path that is not a directory prints an error and is dropped; `run` bails with "No valid search paths given." if none remain.

Sources: [src/main.rs:83-87](repo://src/main.rs#L83-L87), [src/main.rs:131-147](repo://src/main.rs#L131-L147), [src/cli.rs:696-721](repo://src/cli.rs#L696-L721)

`normalize_path` makes each path absolute under `--absolute-path`, rewrites `.` as `./` (a workaround for a ripgrep change), and turns a path named `-` into `./-` so the walker treats it as a path. `is_existing_directory` deliberately avoids `.exists()`, because `.` always exists even after the working directory was deleted.

Sources: [src/cli.rs:723-736](repo://src/cli.rs#L723-L736), [src/filesystem.rs:38-42](repo://src/filesystem.rs#L38-L42)

## Derived options

Several `Opts` methods fold related flags into one value before `Config` sees them.

Sources: [src/cli.rs:747-773](repo://src/cli.rs#L747-L773)

| Method | Result |
| --- | --- |
| `max_depth()` | `--max-depth`, else `--exact-depth` |
| `min_depth()` | `--min-depth`, else `--exact-depth` |
| `threads()` | `--threads`, else available parallelism capped at 64 (1 if unknown) |
| `max_results()` | `--max-results` if above 0, else 1 for `-1` |
| `strip_cwd_prefix(pred)` | false if any search path was given; else `--strip-cwd-prefix` when, defaulting to `pred()` |
| `gen_completions()` | the requested shell, or the shell from the environment |

Sources: [src/cli.rs:747-800](repo://src/cli.rs#L747-L800)

The thread cap exists "to limit startup overhead on massively parallel machines". For `--strip-cwd-prefix`, a bare flag means `Always`, and `construct_config` passes a predicate that is true unless `--print0` or a command is in use, so `./` is kept by default when results go to another program.

Sources: [src/cli.rs:788-800](repo://src/cli.rs#L788-L800), [src/cli.rs:765-773](repo://src/cli.rs#L765-L773), [src/main.rs:390-390](repo://src/main.rs#L390-L390)

## Building Config

### Case and path separator

`construct_config` takes `Opts` by value and moves or computes each field. It first decides case sensitivity (smart case, see [[Pattern Matching]]), then the path separator: `--path-separator` or, on Windows under MSYS (`MSYSTEM` set), `/`. `actual_path_separator` is that value or the platform separator, and on Windows a separator longer than one byte is an error, with a hint that some shells expand `/`.

Sources: [src/main.rs:248-264](repo://src/main.rs#L248-L264), [src/main.rs:234-246](repo://src/main.rs#L234-L246), [src/filesystem.rs:123-136](repo://src/filesystem.rs#L123-L136)

### Colour and hyperlinks

`--color auto` colours output only if ANSI is supported (on Windows, enabling ANSI support succeeded or `TERM` is set), `NO_COLOR` is unset or empty, and stdout is a terminal. When colouring, `ls_colors` comes from `LS_COLORS` or falls back to the built-in `DEFAULT_LS_COLORS` table generated with `vivid`. `--hyperlink auto` follows the colour decision.

Sources: [src/main.rs:271-297](repo://src/main.rs#L271-L297), [src/main.rs:56-60](repo://src/main.rs#L56-L60)

### Filters and templates

`--type` values set flags on a `FileTypes`: `executable` also enables files, and `empty` alone enables both files and directories. Each `--extension` has leading dots trimmed and becomes the case-insensitive regex `.\.ext$` in one `RegexSet`. `--format` is parsed into a `FormatTemplate` ([[Format Templates]]), each `--exclude` glob is prefixed with `!` for the walker's override builder, and `--changed-within`/`--changed-before` become `TimeFilter`s, erroring on values that are neither a date nor a duration.

Sources: [src/main.rs:333-383](repo://src/main.rs#L333-L383), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

### Command

`extract_command` takes the `CommandSet` parsed by `Exec`. Without one, `--list-details` produces a batch command from `determine_ls_command`, which is covered on [[Command Execution]]. `full_path_base` caches the current directory when `--full-path` is set, failing early if it cannot be determined.

Sources: [src/main.rs:298-308](repo://src/main.rs#L298-L308), [src/main.rs:395-410](repo://src/main.rs#L395-L410)

### Ignore settings

The ignore booleans are computed from the negative flags and `-u`, and `require_git_to_read_vcsignore` is the inverse of `--no-require-git`. [[Ignore Rules and Hidden Files]] explains how the walker applies each one.

Sources: [src/main.rs:310-322](repo://src/main.rs#L310-L322)

## Using Config

`Config` has one method, `is_printing`, true when no command is set. The walker uses it to decide whether to precompute colours and install the Ctrl-C handler, and the receiver chooses between printing and running commands on the same condition ([[Parallel Directory Walk]], [[Result Buffering and Exit Codes]]).

Sources: [src/config.rs:138-143](repo://src/config.rs#L138-L143), [src/walk.rs:593-598](repo://src/walk.rs#L593-L598), [src/walk.rs:621-634](repo://src/walk.rs#L621-L634)
