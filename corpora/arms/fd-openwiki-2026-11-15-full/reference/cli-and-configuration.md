---
type: reference
title: CLI Options and Config Mapping
description: Reference for fd's clap-based command line. Covers the Opts struct, option groups, conflicts and override pairs, how search paths are resolved and normalized, derived defaults (threads, max results, strip-cwd-prefix), the environment variables fd reads, and how construct_config turns Opts into the immutable Config.
tags: [cli, clap, options, config, reference, environment]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-2a737474d86fc75cc9d9694f
    resource: repo://src/config.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# CLI Options and Config Mapping

## Shape of the command line

```
fd [OPTIONS] [pattern] [path]...
fd [OPTIONS] --search-path <path> [--search-path <path2> ...] [pattern]
```

`Opts` (`src/cli.rs`) is defined with clap's derive API. Command-level settings that affect behavior:

- `args_override_self = true`: repeating a flag is allowed, and the last value wins.
- `max_term_width = 98` for help output.
- An `execs` argument group made of `exec`, `exec_batch`, and `list_details`. It conflicts with `max_results`, `quiet`, and `max_one_result`.

`-x/--exec` and `-X/--exec-batch` are added by a hand-written `clap::Args` implementation (`Exec`), because clap's derive API can't express grouped multi-occurrence values. Each one takes everything up to a `;` terminator, and the option can be repeated. In the shell you have to write the terminator as `\;`. The collected values become a `CommandSet` (see [Command Execution](../workflows/command-execution.md)).

### Override pairs

Many boolean flags have a hidden counterpart that cancels them, so aliases and wrappers can be overridden later on the command line:

| Flag | Override |
| --- | --- |
| `-H/--hidden` | `--no-hidden` |
| `-I/--no-ignore` | `--ignore` |
| `--no-ignore-vcs` | `--ignore-vcs` |
| `--no-require-git` | `--require-git` |
| `--no-ignore-parent` | `--ignore-parent` |
| `-L/--follow` | `--no-follow` |
| `-a/--absolute-path` | `--relative-path` |
| `-s/--case-sensitive` | `-i/--ignore-case` (they override each other) |
| `-g/--glob` | `--regex` |
| `--max-results` | `-1` (they override each other) |

`-u/--unrestricted` is a counted flag that acts like `--no-ignore --hidden`. It overrides `--ignore` and `--no-hidden`.

### Notable conflicts

- `--glob` conflicts with `--fixed-strings`. `--exact` conflicts with both.
- `-l/--list-details` conflicts with `--absolute-path`, `--print0`, `--format`, `--exec`, and `--exec-batch`.
- `--quiet` conflicts with `--max-results`. `--prune` conflicts with `--size` and `--exact-depth`. `--exact-depth` conflicts with `--min-depth` and `--max-depth`.
- `--search-path` conflicts with positional paths. `--strip-cwd-prefix` conflicts with both, because stripping only makes sense for the implicit `./` root.
- `--batch-size` requires `--exec-batch`.

## Search path resolution

`Opts::search_paths()`:

1. Uses positional paths if any were given, otherwise `--search-path` values. If neither was given, it uses `./`, after first checking that the current directory still exists (`Could not retrieve current directory (has it been deleted?)`).
2. Drops any path that is not an existing directory and prints `Search path '<p>' is not a directory.` for it.
3. Normalizes each remaining path:
   - With `--absolute-path`, the path is normalized and made absolute. On Windows the `\\?\` prefix is removed.
   - `.` becomes `./`, a workaround for an `ignore` crate quirk.
   - `-` becomes `./-`, so the walker treats it as a path (fd#849).

`--base-directory` is applied **before** this step, so relative search paths are resolved against it.

## Derived defaults

| Accessor | Rule |
| --- | --- |
| `threads()` | `-j/--threads` (must be non-zero), otherwise `available_parallelism()` capped at **64**, falling back to 1 |
| `max_depth()` / `min_depth()` | explicit value, otherwise `--exact-depth` |
| `max_results()` | `--max-results N` if N > 0 (so `0` means unlimited), otherwise `Some(1)` when `-1` is given |
| `strip_cwd_prefix(pred)` | only when no search paths were given. `--strip-cwd-prefix` with no value means `always`. `auto` delegates to `!(print0 \|\| has command)` |
| `gen_completions()` | `--gen-completions [shell]`. Without a shell, `Shell::from_env()` is used. Only exists with the `completions` feature |

Hidden options intended for testing or tuning: `--max-buffer-time <ms>`, `--no-global-ignore-file`, `--gen-completions`.

## Opts → Config

`construct_config(opts, &pattern_regexps)` in `src/main.rs` builds `Config` (`src/config.rs`) once. After that, `Config` is never modified, and it is shared read-only by all threads. Key translations:

| Config field | Source |
| --- | --- |
| `case_sensitive` | smart case over the regex sources ([Pattern Matching](../concepts/pattern-matching.md)) |
| `full_path_base` | `current_dir()` when `--full-path` is set |
| `ignore_hidden`, `read_fdignore`, `read_vcsignore`, `read_parent_ignore`, `read_global_ignore`, `require_git_to_read_vcsignore` | ignore flags and `-u` ([Ignore Rules](../concepts/ignore-rules-and-traversal.md)) |
| `file_types`, `extensions`, `size_constraints`, `time_constraints`, `owner_constraint` | filter options ([Entry Filters](../concepts/entry-filters.md)) |
| `ls_colors`, `hyperlink`, `interactive_terminal`, `format`, `path_separator`, `actual_path_separator`, `null_separator`, `strip_cwd_prefix` | output options ([Output Formatting](../concepts/output-formatting.md)) |
| `command` | `-x`/`-X` `CommandSet`, or a synthesized `ls` batch command for `-l` |
| `exclude_patterns` | `--exclude` globs, each prefixed with `!` |
| `threads`, `max_buffer_time`, `max_results`, `quiet`, `prune`, `min_depth`, `max_depth`, `batch_size`, `ignore_contain`, `show_filesystem_errors`, `follow_links`, `one_file_system` | copied or derived directly |

`Config::is_printing()` is true when there is no command. The walker uses it to decide whether to precompute colors and install the Ctrl-C handler.

## Environment variables

| Variable | Effect |
| --- | --- |
| `LS_COLORS` | Color theme. If unset, fd's built-in default is used |
| `NO_COLOR` | When set to a non-empty value, disables color in `--color=auto` |
| `TERM` (Windows) | When set, counts as ANSI support if enabling VT mode fails |
| `MSYSTEM` (Windows) | When non-empty, the default path separator becomes `/` |
| XDG / platform config dir | Location of the global `fd/ignore` file (via `etcetera`) |
| `SHELL` etc. | Used by `--gen-completions` without an argument (`Shell::from_env`) |

## Documentation sources

- The long help text (`--help`) comes from doc comments and `long_help` strings in `src/cli.rs`.
- `doc/fd.1` is a hand-maintained man page.
- The README "Command-line options" block is regenerated from `fd -h` during releases (see [Build, Release and Packaging](../operations/build-release-and-packaging.md)).
