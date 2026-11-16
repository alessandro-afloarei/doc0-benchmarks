---
type: architecture
title: CLI Parsing and Config Construction
description: How fd turns clap-parsed command-line options (Opts) into the immutable Config consumed by the walker, including pattern modes, smart case, color/hyperlink decisions, ignore-flag derivation and early validation errors.
tags: [cli, clap, config, patterns, regex, smart-case, validation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:22.809Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
generated: { by: "claude-code", at: "2026-11-16T16:28:22.809Z" }
---

# CLI Parsing and Config Construction

fd separates *what the user typed* from *what the search engine needs*:

- `src/cli.rs` defines `Opts`, a `clap` derive struct that mirrors the command line one-to-one (including hidden "negation" flags such as `--no-hidden`, `--ignore`, `--no-follow`).
- `src/main.rs` (`run` and `construct_config`) converts `Opts` plus the compiled pattern strings into a `Config` (`src/config.rs`), a plain struct of resolved booleans, limits, filters and output settings.
- After that point nothing reads `Opts` again; `walk::scan` receives only the search paths, the compiled `Regex` list and the `Config`.

See [Architecture Overview](overview.md) for where this sits in the full lifecycle.

## Order of operations in `run`

`run()` in `src/main.rs` is strictly sequential:

1. `Opts::parse()` — clap parses argv. The custom `Exec` args group (see below) already builds `CommandSet` values during parsing.
2. If built with the `completions` feature and `--gen-completions` was passed, print a completion script and return.
3. `set_working_dir` — apply `--base-directory` / `-C` via `env::set_current_dir`, failing if the path is not a directory.
4. `opts.search_paths()` — resolve search roots; error `No valid search paths given.` if none survive.
5. `ensure_search_pattern_is_not_a_path` — reject path-like patterns (see validation).
6. `build_pattern_regex` for every `--and` expression plus the positional pattern, producing regex *source strings*.
7. `construct_config(opts, &pattern_regexps)` — build `Config` (consumes `Opts`).
8. `ensure_use_hidden_option_for_leading_dot_pattern` — reject `^\.`-style patterns when hidden files are filtered.
9. `build_regex` compiles each string into a `regex::bytes::Regex` with the final case sensitivity.
10. `walk::scan(&search_paths, regexps, config)`.

Because case sensitivity is decided from the regex *source* (step 7) before compilation (step 9), smart case works uniformly for regex, glob and literal modes.

## Pattern modes

`build_pattern_regex` maps each pattern to a regex source string:

| Mode | Flag | Resulting regex source |
|------|------|------------------------|
| Glob | `-g/--glob` (and pattern non-empty) | `globset::GlobBuilder` with `literal_separator(true)`, then `glob.regex()` |
| Exact | `--exact` | `^` + `regex::escape(pattern)` + `$` |
| Fixed string | `-F/--fixed-strings` (alias `--literal`) | `regex::escape(pattern)` (substring match) |
| Regex (default) | `--regex` | pattern unchanged |

clap enforces that `--glob` conflicts with `--fixed-strings`, and `--exact` conflicts with both. `--regex` overrides `--glob`. The positional pattern defaults to `""`, which matches everything.

`--and <pattern>` values (`opts.exprs`) are chained *before* the positional pattern and all go through the same mode; the walker requires **every** regex to match (see [Parallel Walk Pipeline](parallel-walk-pipeline.md)).

`build_regex` compiles with `case_insensitive(!config.case_sensitive)` and `dot_matches_new_line(true)`. Compile errors get a hint suggesting `--fixed-strings`, `--exact` or `--glob`.

## Smart case

`case_sensitive = !ignore_case && (case_sensitive_flag || any pattern has an uppercase char)`.

`regex_helper::pattern_has_uppercase_char` parses the regex with `regex_syntax` and walks the HIR looking for uppercase *literals* or class bounds. Escapes are therefore not misdetected: `\Acargo` and `carg\x6F` are lowercase patterns. `-i` always wins over `-s` and smart case; `-s` and `-i` override each other on the command line.

## Ignore and visibility flags

`construct_config` derives the walker's ignore switches from several overlapping flags. `-u/--unrestricted` (`rg_alias_hidden_ignore`, counted) acts as `--no-ignore --hidden`:

| Config field | Formula |
|--------------|---------|
| `ignore_hidden` | `!(hidden \|\| unrestricted)` |
| `read_fdignore` | `!(no_ignore \|\| unrestricted)` |
| `read_vcsignore` | `!(no_ignore \|\| unrestricted \|\| no_ignore_vcs)` |
| `require_git_to_read_vcsignore` | `!no_require_git` |
| `read_parent_ignore` | `!no_ignore_parent` |
| `read_global_ignore` | `!(no_ignore \|\| unrestricted \|\| no_global_ignore_file)` |

How the walker uses these is covered in [Filtering and Ignore Rules](../concepts/filtering-and-ignore-rules.md).

## Search paths

`Opts::search_paths` uses positional `path` args, else `--search-path`, else `./` (after checking the CWD still exists — "has it been deleted?"). Non-directory paths are reported with `print_error` and dropped rather than aborting. `normalize_path`:

- with `-a/--absolute-path`, normalizes and makes the path absolute;
- rewrites `.` to `./` (workaround for a ripgrep/ignore issue);
- rewrites `-` to `./-` so the walker treats it as a path.

`filesystem::is_existing_directory` avoids `exists()` because `.` always exists even when the CWD has been deleted.

## Output-related decisions

- **Color**: `--color always|never|auto`. `auto` = ANSI support (on Windows: `enable_ansi_support()` succeeds or `TERM` is set) **and** `NO_COLOR` unset/empty **and** stdout is a terminal. When colored, `LsColors::from_env()` is used, falling back to the built-in `DEFAULT_LS_COLORS` string (a vivid "molokai" theme) in `main.rs`.
- **Hyperlinks**: `--hyperlink[=when]` defaults to `never`; bare `--hyperlink` means `auto`, which follows the color decision.
- **Path separator**: `--path-separator` or, on Windows under MSYS (`MSYSTEM` set), `/` via `filesystem::default_path_separator`. On Windows the separator must be exactly one byte.
- **strip-cwd-prefix**: only applies when no explicit search path was given. `auto` strips `./` unless `--print0` or a command (`--exec`, `--exec-batch`, `--list-details`) is active; `--strip-cwd-prefix` without a value means `always`.
- `interactive_terminal` caches whether stdout is a TTY; it drives sanitization and raw-byte output (see [Output Rendering](../systems/output-rendering.md)).

## Limits and other fields

- `max_depth = --max-depth or --exact-depth`; `min_depth = --min-depth or --exact-depth`. `--exact-depth` conflicts with both.
- `max_results`: `--max-results N` (0 ignored) or `-1` → 1. `--exec`, `--exec-batch` and `--list-details` conflict with `--max-results`, `-1` and `--quiet` via the `execs` arg group.
- `threads`: `-j/--threads` (non-zero) or `available_parallelism()` capped at 64, falling back to 1.
- `--max-buffer-time` (hidden, milliseconds) feeds the receiver buffering deadline.
- `file_types`: `-t` values map onto `FileTypes` booleans; `executable` also sets `files`; `empty` alone implies both files and directories.
- `extensions`: each `-e` value has leading dots trimmed and becomes a case-insensitive `RegexSet` entry `.\.<ext>$`.
- `exclude_patterns`: each `-E` glob is stored prefixed with `!` (override-ignore syntax).
- `size_constraints` parsed by `SizeFilter::from_string` at clap time; `time_constraints` from `--changed-within` / `--changed-before` via `TimeFilter` (invalid values error out); `owner_constraint` (Unix only) drops no-op filters such as `""` or `":"`.
- `full_path_base`: with `--full-path`, the CWD is captured once so the walker can build absolute match strings.
- `command`: `--exec` / `--exec-batch` from the `Exec` group, or a synthesized batch `ls -l -h -d` command for `--list-details` (see [Command Execution](../systems/command-execution.md)).

## Early validation errors

- **Pattern contains a path separator** (`ensure_search_pattern_is_not_a_path`): without `--full-path`, any pattern (positional or `--and`) containing `/` is rejected with advice to use `fd . 'dir'` or `--full-path`. On Windows a `\` pattern is rejected only if it names an existing directory, because `\` is also the regex escape char.
- **Leading-dot pattern with hidden filtering** (Unix only): if hidden files are ignored and a pattern's HIR starts with a start anchor followed by a literal `.` (e.g. `^\.gitignore`), fd errors and suggests `-H`. Only this simplest form is detected.
- `--base-directory` that is not a directory, invalid time strings, malformed size/owner strings, and invalid regexes all fail before any traversal starts.

## Exec argument group

`Exec` implements `clap::Args`/`FromArgMatches` by hand because clap's derive API cannot capture grouped occurrences. `-x/--exec` and `-X/--exec-batch` take `1..` values, allow hyphen values and terminate at `;`; each occurrence becomes one command in a `CommandSet`. Errors from `CommandSet::new*` are surfaced as clap `InvalidValue` errors.

## Tests

Integration tests in `tests/tests.rs` cover these paths, e.g. `test_smart_case`, `test_case_insensitive`, `test_glob_searches`, `test_fixed_strings`, `test_exact_literal_nonsubstring`, `test_and_*`, `test_pattern_with_forward_slash_is_rejected`, `test_error_if_hidden_not_set_and_pattern_starts_with_dot`, `test_strip_cwd_prefix`, `test_invalid_cwd`, `test_number_parsing_errors`. Unit tests for the HIR helpers live at the bottom of `src/regex_helper.rs`.
