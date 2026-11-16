---
type: architecture
title: CLI Parsing and Config Construction
description: How fd's clap-derived Opts struct is turned into the immutable Config used by the walker, including hand-rolled --exec parsing, search path normalization, color/hyperlink resolution, thread defaults and early validation errors.
tags: [cli, clap, config, rust, fd]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-2a737474d86fc75cc9d9694f
    resource: repo://src/config.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# CLI Parsing and Config Construction

fd separates *what the user typed* (`Opts`, in `src/cli.rs`) from *what the search engine needs* (`Config`, in `src/config.rs`). `src/main.rs::run` is the bridge: it parses `Opts`, derives regexes, builds a `Config`, and hands both to `walk::scan` (see [[architecture/overview]] and [[architecture/parallel-walk-pipeline]]).

## Opts: the clap surface

`Opts` derives `clap::Parser` and sets `args_override_self = true`, so repeating a flag is allowed and the last occurrence wins. Many boolean flags come in a visible/hidden pair that use `overrides_with` (for example `--hidden` / `--no-hidden`, `--no-ignore` / `--ignore`, `--follow` / `--no-follow`), which lets users override flags from shell aliases on the command line.

Notable conventions:

- **Aliases.** Compatibility aliases such as `--maxdepth`, `--mindepth`, `--dereference`, `--newer`, `--older`, `--mount`/`--xdev` exist alongside the canonical names. `-u/--unrestricted` is a counted flag exposed through `Opts::rg_alias_ignore()`, equivalent to `--no-ignore --hidden`.
- **Conflict groups.** An `ArgGroup` named `execs` (`--exec`, `--exec-batch`, `--list-details`) conflicts with `--max-results`, `--quiet` and `--max-one-result`, because command execution consumes results rather than counting them.
- **Depth shortcuts.** `--exact-depth` is stored separately, and `Opts::max_depth()`/`min_depth()` fall back to it, so it behaves as both limits.
- **Results limits.** `Opts::max_results()` treats `0` as "no limit" and maps `--max-one-result` to `Some(1)`.
- **Threads.** `Opts::threads()` uses the user's `NonZeroUsize` or `default_num_threads()`, which is `available_parallelism()` capped at 64 (falling back to 1) to limit startup cost on very wide machines.

### Hand-rolled `--exec` / `--exec-batch`

clap's derive API cannot capture grouped multi-value occurrences, so `Exec` implements `clap::Args` and `FromArgMatches` manually in `src/cli.rs`. Both options take `num_args(1..)`, allow hyphen values, and end at a `;` terminator. `from_arg_matches` turns the occurrences into `CommandSet::new` or `CommandSet::new_batch`, and template errors (e.g. no executable) are surfaced as clap `InvalidValue` errors. See [[architecture/command-execution]] for what happens next.

### Search paths

`Opts::search_paths()` chooses positional paths, then `--search-path` values (mutually exclusive), then the current directory. Non-directories are reported with `print_error` and dropped; if none remain, `run` aborts with "No valid search paths given." `normalize_path` rewrites `.` to `./` (a workaround for a ripgrep issue), prefixes a bare `-` with `./` so the walker treats it as a path, and makes paths absolute when `--absolute-path` is set.

`strip_cwd_prefix` is only ever true when **no** explicit search path was given. In `Auto` mode it is enabled unless `--print0` or a command is in use (the `./` prefix is kept there to protect against paths beginning with `-`).

## Config: derived, immutable settings

`main.rs::construct_config` consumes `Opts` and builds `Config`. Key derivations:

| Config field | Derivation |
| --- | --- |
| `case_sensitive` | `!ignore_case && (case_sensitive flag \|\| any pattern has an uppercase literal)` (smart case, see [[architecture/pattern-matching]]) |
| `ignore_hidden` | `!(--hidden \|\| -u)` |
| `read_fdignore` / `read_vcsignore` / `read_global_ignore` | disabled by `--no-ignore` or `-u`; the VCS and global variants have their own `--no-ignore-vcs` / `--no-global-ignore-file` switches |
| `ls_colors` | `Some` only when color is enabled; from `LS_COLORS` env or the built-in `DEFAULT_LS_COLORS` |
| `hyperlink` | `Always`/`Never`, or follows `colored_output` for `Auto` |
| `extensions` | a case-insensitive `RegexSet` of `.\.ext$` patterns, leading dots trimmed |
| `file_types` | folded from repeated `--type` values into a `FileTypes` struct |
| `command` | explicit `--exec`/`--exec-batch`, or an `ls` command for `--list-details` |
| `full_path_base` | current directory, only when `--full-path` is set |

Color decision (`ColorWhen::Auto`): colors are on only if ANSI support is available (always on Unix; probed on Windows), `NO_COLOR` is unset or empty, and stdout is a terminal. `interactive_terminal` is recorded separately because it also controls output sanitization (see [[architecture/output-and-terminal-safety]]).

`Config::is_printing()` is simply `command.is_none()`; the walker uses it to decide whether to precompute styles and install the Ctrl-C handler.

## Early validation

Before the walk begins, `main.rs` fails fast with `anyhow` errors for common mistakes:

- a pattern containing `/` without `--full-path` (it could never match a file name) — see [[architecture/pattern-matching]];
- a pattern that only matches leading-dot names while hidden files are filtered (Unix only);
- invalid size / time / owner strings, and a `--path-separator` longer than one byte on Windows;
- a nonexistent `--base-directory`, which is applied with `set_current_dir` before any path handling.

Errors bubble up to `main`, which prints `[fd error]: ...` through `print_error` and exits with `ExitCode::GeneralError` (see [[architecture/overview]]).

## Extending

Adding a flag generally means: add the field to `Opts` in `cli.rs`, add a matching field to `Config`, populate it in `construct_config`, and read it in `walk.rs` (filter) or `output.rs` (rendering). Platform-specific options are gated with `#[cfg(unix)]` on both the `Opts` and `Config` fields (for example `owner`/`owner_constraint`).
