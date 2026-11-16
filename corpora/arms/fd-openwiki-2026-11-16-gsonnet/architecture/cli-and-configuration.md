---
type: architecture
title: CLI Parsing and Config Construction
description: How fd turns command-line arguments (clap `Opts`) into the immutable `Config` used by the walker, including search-path resolution, flag overrides/aliases, color, hyperlink, thread and strip-prefix decisions, and startup diagnostics.
tags: [cli, clap, configuration, startup, validation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-2a737474d86fc75cc9d9694f
    resource: repo://src/config.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# CLI Parsing and Config Construction

fd's startup is a strictly ordered, fail-fast sequence in `run()` (`src/main.rs`). The raw clap-derived `Opts` struct (`src/cli.rs`) is validated and then *lowered* into a plain, immutable `Config` (`src/config.rs`) that every later stage reads. After this point no component re-reads `Opts`.

## Startup sequence

1. `Opts::parse()` (clap derive). With the default `completions` feature, `--gen-completions [shell]` short-circuits: it prints a completion script (program name taken from `argv[0]`'s file stem) and exits successfully.
2. `set_working_dir`: `--base-directory` must be an existing directory; the process `chdir`s into it, so all later relative paths are relative to it.
3. `Opts::search_paths()`: resolves roots (see below). An empty result aborts with `No valid search paths given.`
<!-- openwiki: broken internal link [/openwiki/concepts/pattern-matching.md] link "/openwiki/concepts/pattern-matching.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
4. `ensure_search_pattern_is_not_a_path`: rejects patterns containing a path separator unless `--full-path` is given (see [pattern matching](/openwiki/concepts/pattern-matching.md)).
5. Each pattern (the `--and` expressions plus the positional pattern) is converted to a regex *string* by `build_pattern_regex`.
6. `construct_config` builds `Config`.
7. `ensure_use_hidden_option_for_leading_dot_pattern`: on Unix, errors when hidden files are filtered but a pattern can only match names with a leading dot.
8. `build_regex` compiles each pattern to a `regex::bytes::Regex` (case-insensitivity decided by `Config.case_sensitive`) and `walk::scan` runs the search.

<!-- openwiki: broken internal link [/openwiki/operations/exit-codes-and-error-handling.md] link "/openwiki/operations/exit-codes-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Any `Err` from `run()` is printed through `print_error` and exits with `ExitCode::GeneralError` (see [exit codes](/openwiki/operations/exit-codes-and-error-handling.md)).

## Search paths

`Opts::search_paths` prefers positional `path` arguments, then `--search-path` (which conflicts with positional paths), then falls back to the current directory (checked to still exist). Non-directory entries are reported with `Search path '…' is not a directory.` and *dropped* rather than failing the run, so a mixed list of valid and invalid roots still searches the valid ones. `normalize_path` rewrites `.` to `./` (a workaround for an upstream walker issue), prefixes a lone `-` with `./` so it is treated as a path, and makes paths absolute with `--absolute-path`.

## Flag semantics worth knowing

- **Toggle pairs**: many flags (`--hidden`/`--no-hidden`, `--no-ignore`/`--ignore`, `--follow`/`--no-follow`, …) have hidden counterparts using `overrides_with`, so the last one on the command line wins, which allows shell aliases to be overridden.
- **`-u/--unrestricted`** is counted (`rg_alias_hidden_ignore`); `rg_alias_ignore()` makes `Config` behave as if both `--hidden` and `--no-ignore` were set.
- **Depth**: `--exact-depth` supplies both min and max depth via `Opts::max_depth()`/`min_depth()`.
- **Results limit**: `max_results()` treats `--max-results 0` as unlimited and `-1/--max-one-result` as 1.
- **Execution group**: `--exec`, `--exec-batch` and `--list-details` form an exclusive `ArgGroup` that also conflicts with `--max-results`, `--quiet` and `--max-one-result`. `--exec`/`--exec-batch` are parsed by a hand-written `Exec` (`FromArgMatches`) because clap's derive can't collect grouped multi-values; a `;` terminator ends the command and hyphen-leading values are allowed. Parse errors from `CommandSet` become clap `InvalidValue` errors.
- **Threads**: `--threads` is a `NonZeroUsize`; the default is `available_parallelism()` capped at 64, falling back to 1.
- **Hidden tuning flag**: `--max-buffer-time` (milliseconds) is a hidden knob for the output buffering window used by tests and tuning.

## Config construction decisions (`construct_config`)

- **Case sensitivity**: sensitive iff `--ignore-case` is absent and (`--case-sensitive` is set or *any* pattern contains a literal uppercase character - "smart case").
- **Path separator**: `--path-separator`, else on Windows under MSYS (`MSYSTEM` set) `/`. On Windows a custom separator longer than one byte is an error with a hint about shell expansion of `/`. `actual_path_separator` keeps the effective separator for trailing-slash printing.
- **Color**: `--color always|never|auto`. `auto` enables color only when stdout is a terminal, `NO_COLOR` is unset/empty, and ANSI is supported (always on Unix; probed or `TERM`-based on Windows). When enabled, `LsColors::from_env()` is used, falling back to the built-in `DEFAULT_LS_COLORS` (a Molokai-style theme embedded in `main.rs`).
- **Hyperlinks**: `--hyperlink auto` follows `colored_output`.
- **Strip prefix**: `Opts::strip_cwd_prefix` only applies when no explicit search paths were given; in auto mode it is enabled unless `--print0` or a command is in use, so that those outputs keep a `./` prefix guarding against leading-dash names.
- **Full path**: `--full-path` captures `env::current_dir()` into `full_path_base` (failing with a clear message if the cwd is gone), so patterns can later be matched against absolute paths.
<!-- openwiki: broken internal link [/openwiki/concepts/ignore-and-visibility-rules.md] link "/openwiki/concepts/ignore-and-visibility-rules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Ignore flags**: `ignore_hidden`, `read_fdignore`, `read_vcsignore`, `read_parent_ignore`, `read_global_ignore`, `require_git_to_read_vcsignore` are derived from `--hidden`, `--no-ignore`, `--no-ignore-vcs`, `--no-ignore-parent`, `--no-global-ignore-file`, `--no-require-git` (details in [ignore rules](/openwiki/concepts/ignore-and-visibility-rules.md)).
- **File types**: `--type` values populate `FileTypes`; `executable` implies `files`, and `empty` alone implies files *and* directories.
- **Extensions**: `-e` values (leading dots trimmed) become a case-insensitive `RegexSet` of `.\.ext$`.
<!-- openwiki: broken internal link [/openwiki/concepts/entry-filters.md] link "/openwiki/concepts/entry-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Size/time/owner**: `--size` values are parsed by clap value parsers; `--changed-within/before` go through `TimeFilter` and produce a "not a valid date or duration" error; `--owner` is Unix-only and a no-op spec (`:`) yields no filter. See [entry filters](/openwiki/concepts/entry-filters.md).
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Command**: `extract_command` takes the parsed `--exec` set or, for `--list-details`, builds a batch `CommandSet` around an `ls` invocation (GNU `ls`/`gls` when available; BSD `ls` otherwise; Windows requires GNU `ls`). See [command execution](/openwiki/workflows/command-execution.md).
- **Exclude patterns**: each `--exclude` is stored with a `!` prefix so it becomes a negated override glob.

`Config::is_printing()` (true when no command is set) is the switch that distinguishes the printing path from the command path throughout the walker.

## Extension seams

<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Adding a new option typically means: a field on `Opts` in `src/cli.rs`, a derived field in `Config`, the lowering in `construct_config`, and consumption either in `WorkerState::build_walker` (traversal behavior) or in the sender closure in `src/walk.rs` (per-entry filtering). Integration tests in `tests/tests.rs` (e.g. `test_opposing`, `test_number_parsing_errors`) cover override and parse-error behavior; see [the test harness](/openwiki/testing/integration-test-harness.md).
