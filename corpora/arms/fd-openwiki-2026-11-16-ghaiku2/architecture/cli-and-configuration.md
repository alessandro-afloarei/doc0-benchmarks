---
type: architecture
title: CLI Parsing and Configuration
description: How fd parses its clap-derived command line, turns the pattern and flags into compiled regular expressions and a Config, and which options control case sensitivity, pattern interpretation, ignore behavior and execution mode.
tags: [cli, clap, configuration, regex, smart-case, rust]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:10:54.611Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
generated: { by: "claude-code", at: "2026-11-16T18:10:54.611Z" }
---

# CLI Parsing and Configuration

This page covers the front half of every `fd` invocation: from `argv` to a
validated set of search paths, compiled patterns and an immutable `Config`
that the traversal engine consumes. The traversal itself is described in
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Parallel Directory Traversal](/openwiki/architecture/parallel-traversal.md).

## Responsibilities

| Concern | Owner |
| --- | --- |
| Option declarations, help text, conflicts, defaults | `src/cli.rs` (`Opts`) |
| Search path resolution and `--base-directory` | `src/cli.rs` (`search_paths`), `src/main.rs` (`set_working_dir`) |
| Pattern-to-regex translation (glob, fixed, exact, regex) | `src/main.rs` (`build_pattern_regex`) |
| Case-sensitivity decision | `src/main.rs` (`construct_config`), `src/regex_helper.rs` |
| Derived runtime settings | `src/main.rs` (`construct_config`) producing `src/config.rs` (`Config`) |
| Execution-mode resolution (`-x`, `-X`, `-l`) | `src/main.rs` (`extract_command`, `determine_ls_command`) |

`Config` is a plain data struct with one boolean or small value per behavior;
its only method, `is_printing`, reports whether no `--exec` command was given.

## Command-line model

`Opts` is a `clap` derive struct (`src/cli.rs`) with `args_override_self = true`,
so a repeated option takes its last value. Two groups are enforced by clap:

- `--exec`, `--exec-batch` and `--list-details` form one `execs` group, so at
  most one of them is accepted. The group also conflicts with `--max-results`,
  `--quiet` and `--max-one-result`.
- `--gen-completions` is hidden and exclusive; it is only compiled with the
  default `completions` Cargo feature.

Several derived accessors on `Opts` normalize raw flags:

- `max_depth()` and `min_depth()` fall back to `--exact-depth` when the
  specific flag is absent.
- `threads()` uses `--threads` or, by default, the available parallelism
  capped at 64.
- `max_results()` treats `--max-results 0` as unset and maps `--max-one-result`
  to a limit of one.
- `rg_alias_ignore()` is true when the ripgrep-compatibility `-u` alias was
  used (`rg_alias_hidden_ignore > 0`); it disables several ignore sources at
<!-- openwiki: broken internal link [/openwiki/architecture/search-filters.md] link "/openwiki/architecture/search-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  once, as described in [Search Filters and Ignore Rules](/openwiki/architecture/search-filters.md).

## Startup sequence

`main()` calls `run()`, which performs these steps in order
(`src/main.rs`, `run`):

1. Parse `Opts`. If `--gen-completions` was given, print the completion script
   and return without searching.
2. `set_working_dir`: when `--base-directory` is set, verify it is an existing
   directory and change the process working directory into it.
3. `Opts::search_paths()` resolves the roots. An explicit `--search-path`
   or positional path that is not a directory is reported with an error and
   dropped; if none remain, the run fails with "No valid search paths given".
   With no path, the search root is `./`.
4. `ensure_search_pattern_is_not_a_path` rejects a pattern containing `/`
   (and, on Windows only, a separator that names an existing directory) unless
   `--full-path` is set. The check covers the positional pattern and every
   `--and` pattern, because all of them are matched against file names.
5. Each pattern (the positional one plus every `--and` expression) is passed
   through `build_pattern_regex`, which yields a regex source string:
   - `--glob` converts the glob with `globset`, with `literal_separator(true)`;
   - `--exact` anchors a regex-escaped copy as `^...$`;
   - `--fixed-strings` escapes the pattern;
   - otherwise the pattern is used as a regular expression unchanged.
6. `construct_config` builds the `Config` (details below).
7. `ensure_use_hidden_option_for_leading_dot_pattern` fails on Unix when hidden
   files are excluded and a pattern can only match names starting with `.`
   (checked via `regex_helper::pattern_matches_strings_with_leading_dot`).
8. Each regex source is compiled with `build_regex`, which sets
   `case_insensitive(!config.case_sensitive)` and `dot_matches_new_line(true)`.
   A compile failure is reported with a hint about `--fixed-strings`,
   `--exact` and `--glob`.
9. `walk::scan(&search_paths, regexps, config)` starts the search.

## Case sensitivity (smart case)

`construct_config` sets `case_sensitive` to true only when `--ignore-case` is
absent and either `--case-sensitive` was given or some pattern contains a
literal uppercase character. `regex_helper::pattern_has_uppercase_char`
inspects the parsed `regex-syntax` HIR, so escapes and character classes do not
count as uppercase literals. The result is that a lowercase pattern matches
case-insensitively, while any uppercase literal turns the search case-sensitive.

## Config fields that matter downstream

`construct_config` maps options to the fields below. The traversal and output
code only read these values; it never reads `Opts`.

- Ignore behavior: `ignore_hidden`, `read_fdignore`, `read_vcsignore`,
  `require_git_to_read_vcsignore`, `read_parent_ignore`, `read_global_ignore`,
  `exclude_patterns` (each `--exclude` pattern is prefixed with `!`), and
  `ignore_files`. `--no-ignore` and the `-u` alias switch several of these
  off together; `--no-ignore-vcs` only removes the VCS source.
- Traversal shape: `follow_links`, `one_file_system`, `max_depth`,
  `min_depth`, `prune`, `threads`, `ignore_contain`.
- Entry selection: `file_types` (built from `--type`; `empty` alone implies
  files and directories), `extensions` (compiled into a case-insensitive
  `RegexSet` of `\.ext$`), `size_constraints`, `time_constraints` and
  `owner_constraint` (Unix only).
- Matching target: `full_path_base`, which is set only with `--full-path`.
  Without it, a pattern is matched against the file name alone.
- Output: `ls_colors` (only when colors are enabled), `hyperlink`,
  `format`, `null_separator`, `path_separator`, `actual_path_separator`,
  `strip_cwd_prefix`, `quiet`, `show_filesystem_errors`, `max_buffer_time`,
  `max_results`.
- Execution: `command` (a `CommandSet` wrapped in `Arc`) and `batch_size`.

Color decisions follow `--color` (`always`, `never`, `auto`). `auto` enables
colors only when stdout is a terminal, the platform supports ANSI, and
`NO_COLOR` is unset or empty. Hyperlinks follow the same rule under `auto`.
`LS_COLORS` is read from the environment, falling back to a built-in palette.

Two defaults are decided here rather than in the walker:

- `strip_cwd_prefix` is on automatically when no search path was given and no
  `--exec` command or null separator is in use, so `fd` prints `foo` rather
  than `./foo`.
- `--list-details` is implemented by synthesizing a batch `ls` command
  (`determine_ls_command`), so it reuses the `--exec-batch` path. On Windows it
  requires GNU `ls` on `PATH`; on other unsupported platforms it fails.

## Path handling details

`Opts::normalize_path` rewrites `.` to `./` (a workaround for the ripgrep
walker behavior referenced in the source) and prefixes a lone `-` with `./` so
the walker treats it as a path rather than an option. With `--absolute-path`,
roots are normalized and made absolute. Output path construction is covered
<!-- openwiki: broken internal link [/openwiki/workflows/output-formatting.md] link "/openwiki/workflows/output-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
in [Output Formatting](/openwiki/workflows/output-formatting.md).

`--path-separator` is validated for length only on Windows, where a separator
must be exactly one byte. When the option is absent, `filesystem::default_path_separator`
supplies a platform default for MSYS-style environments.

## Failure behavior

- Configuration errors (invalid time expression, owner filter parse failure,
  invalid regex, malformed exclude pattern) are returned as `anyhow` errors
  from `run()`. `main()` prints them through `error::print_error` and exits
  with `ExitCode::GeneralError`.
- A non-directory search root is not fatal on its own; it is reported and
  skipped, and the run continues with the remaining roots.
- Regex compile errors do not panic; they are reported with the suggestion
  to use `--fixed-strings`, `--exact` or `--glob`.

## Extension seams

- New flags are added as fields on `Opts` with clap attributes. If the flag
  changes the search, derive the corresponding `Config` field in
  `construct_config` rather than reading `Opts` in the walker.
- Pattern-level transformations belong in `build_pattern_regex`, which runs
  before both the leading-dot check and regex compilation.
- Path-separator and hyperlink decisions are isolated to `Config` fields and
  are therefore testable through `tests/tests.rs`.

## Tests

Unit tests in `src/regex_helper.rs` cover the uppercase and leading-dot
detectors. Integration tests in `tests/tests.rs` exercise the user-visible
behavior of these options, such as glob, exact, fixed-string and smart-case
<!-- openwiki: broken internal link [/openwiki/testing/integration-tests.md] link "/openwiki/testing/integration-tests.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
searches. See [Testing Strategy](/openwiki/testing/integration-tests.md).

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [System Overview](/openwiki/architecture/overview.md)
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Parallel Directory Traversal](/openwiki/architecture/parallel-traversal.md)
<!-- openwiki: broken internal link [/openwiki/architecture/search-filters.md] link "/openwiki/architecture/search-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Search Filters and Ignore Rules](/openwiki/architecture/search-filters.md)
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Command Execution](/openwiki/workflows/command-execution.md)
