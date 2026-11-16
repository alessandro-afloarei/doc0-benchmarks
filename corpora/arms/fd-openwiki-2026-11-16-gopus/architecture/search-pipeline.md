---
type: architecture
title: "Search Pipeline: From Arguments to Results"
description: End-to-end control flow of a single fd invocation in src/main.rs, from clap parsing through search-path resolution, pattern-to-regex translation, Config construction and validation, to the handoff into walk::scan.
tags: [architecture, control-flow, main, config, cli]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-2a737474d86fc75cc9d9694f
    resource: repo://src/config.rs
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Search Pipeline: From Arguments to Results

fd is a single binary (`[[bin]] name = "fd"`, `src/main.rs`). All work happens in
`run()`, which returns a `Result<ExitCode>`; `main()` exits with that code, or
prints the error chain via `print_error` and exits with
`ExitCode::GeneralError` (see [Exit Codes and Errors](../reference/exit-codes-and-errors.md)).

## Stages of `run()`

1. **Parse arguments.** `Opts::parse()` (clap derive, `src/cli.rs`) produces the
   raw option struct. Usage errors are reported by clap itself. See
   [CLI Options Reference](../reference/cli-options.md).
2. **Shell completions shortcut.** With the default `completions` feature,
   `--gen-completions [shell]` short-circuits: `print_completions` generates a
   script via `clap_complete` using the invoked program's file stem as the name
   (so a binary installed as `fdfind` gets `fdfind` completions) and returns.
3. **Base directory.** `set_working_dir` validates `--base-directory` and
   `chdir`s into it, so every later relative path is relative to that directory.
4. **Search paths.** `opts.search_paths()` uses positional `<path>` arguments, or
   `--search-path` values, or defaults to `./` (erroring if the current directory
   has been deleted). Paths that are not existing directories are reported with
   `print_error` and dropped; if none survive, the run fails with
   "No valid search paths given." `normalize_path` makes paths absolute under
   `--absolute-path`, rewrites `.` as `./`, and rewrites a literal `-` as `./-` so
   the walker treats it as a path.
5. **Path-in-pattern diagnostic.** Unless `--full-path` is set,
   `ensure_search_pattern_is_not_a_path` rejects the primary pattern or any
   `--and` pattern containing `/` (and, on Windows, a `\` pattern naming an
   existing directory), suggesting `fd . 'dir'` or `fd --full-path` instead.
6. **Pattern strings.** Each `--and` expression plus the positional pattern is
   converted to a regex *source string* by `build_pattern_regex` (glob → regex,
   `--exact` → anchored escaped, `--fixed-strings` → escaped, else verbatim). See
   [Pattern Matching](../concepts/pattern-matching.md).
7. **Config construction.** `construct_config(opts, &pattern_regexps)` consumes
   `Opts` and produces the immutable `Config` (`src/config.rs`).
8. **Hidden-file diagnostic.** On Unix, if hidden files are being skipped and a
   pattern can only match names starting with a literal dot (e.g. `^\.foo`), fd
   fails with a hint to add `-H/--hidden`.
9. **Compile regexes.** `build_regex` compiles each pattern string as a
   `regex::bytes::Regex` with case-insensitivity from `Config.case_sensitive`
   and `dot_matches_new_line(true)`. Compile errors get an extra note suggesting
   `--fixed-strings`, `--exact`, or `--glob`.
10. **Scan.** `walk::scan(&search_paths, regexps, config)` performs the traversal
    and returns the final exit code. See
    [Parallel Walk, Batching, and the Receiver](parallel-walk-and-receiver.md).

Smart case must be decided before regexes are compiled, which is why Config is
built from the pattern *strings* and the regexes are compiled afterwards.

## What `construct_config` decides

`Config` is the single, read-only bag of settings shared (by reference) with
every walker, receiver, and exec thread. Notable derivations:

| Concern | Rule |
| --- | --- |
| Case sensitivity | `!ignore_case && (case_sensitive \|\| any pattern has an uppercase literal)` |
| Path separator | `--path-separator`, else `/` on Windows when `MSYSTEM` is set (MSYS/MSYS2), else the OS default; on Windows it must be exactly one byte |
| Colors | `--color always/never`; `auto` requires ANSI support, a TTY stdout, and an unset or empty `NO_COLOR` |
| LS_COLORS | Parsed from the `LS_COLORS` env var, falling back to a built-in default palette (generated with `vivid`, molokai) |
| Hyperlinks | `--hyperlink auto` follows the color decision |
| Command | `--exec`/`--exec-batch` command, or the `ls -l` batch command synthesized for `--list-details` |
| Ignore toggles | `-u/--unrestricted`, `--no-ignore`, `--no-ignore-vcs`, `--no-global-ignore-file`, `--no-ignore-parent`, `--no-require-git` mapped onto `read_*` booleans |
| File types | `--type` values folded into `FileTypes`; `executable` implies files; `empty` alone implies files and directories |
| Extensions | `RegexSet` of case-insensitive `.\.ext$` patterns (leading dots trimmed) |
| Excludes | each `--exclude` glob prefixed with `!` for ignore overrides |
| Full path | `--full-path` caches `current_dir()` in `full_path_base` |
| `./` stripping | Only when no explicit search path is given; `auto` strips unless `--print0` or a command is in use |

Size, time (`--changed-within` / `--changed-before`, parsed by `TimeFilter`; an
unparsable value is an error), and owner constraints are moved into Config as
filter lists; see [Entry Filters](../concepts/entry-filters.md).

`Config::is_printing()` is simply "no command configured", and it gates
work that only matters for terminal output (style precomputation, Ctrl-C
handler).

## Failure behavior

All validation failures before the scan are `anyhow` errors bubbling out of
`run()`; they print as `[fd error]: ...` (sanitized if stderr is a terminal) and
exit with code 1. Invalid individual search paths are non-fatal warnings.

## Extension seams

Adding a new option generally means: add a field to `Opts` in `cli.rs`, add the
derived field to `Config`, populate it in `construct_config`, and consume it in
`walk.rs` (filtering) or `output.rs` (presentation).

## Related tests

`tests/tests.rs` covers the diagnostics (e.g. patterns containing `/`, leading-dot
patterns, invalid search paths, `--base-directory`) by running the real binary in
a temporary directory; see [Test Suite](../testing/test-suite.md).
