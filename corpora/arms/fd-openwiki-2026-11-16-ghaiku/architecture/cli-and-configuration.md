---
type: architecture
title: CLI Parsing and Configuration
description: How fd turns command-line arguments into the Opts struct and then into the single Config value that drives the walker, covering pattern-mode selection, smart case, startup validation, ignore-rule wiring, color and hyperlink resolution, and thread defaults.
tags: [cli, configuration, clap, startup, patterns, smart-case]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# CLI Parsing and Configuration

This page explains the startup half of `fd`: how the user's command line becomes a
validated `Config` value. Everything after `walk::scan` is driven by that value, so
most behavior switches (ignore rules, case sensitivity, output style, depth, threads)
can be traced back to a field assigned here. For the overall pipeline see
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Architecture Overview](/openwiki/architecture/overview.md).

## Responsibilities

- **`src/cli.rs`** owns the argument surface. `Opts` is a clap `Parser` derive
  (`#[command(name = "fd", ...)]`) that holds every flag and positional argument. It also
  contains small helpers that interpret raw flags: `search_paths`, `max_depth`,
  `min_depth`, `threads`, `max_results`, `strip_cwd_prefix`, and `rg_alias_ignore`.
- **`src/main.rs`** owns orchestration. `run()` parses `Opts`, performs validation, builds
  the regex list, calls `construct_config`, and finally hands off to `walk::scan`.
- **`src/config.rs`** defines `Config`, a plain struct of resolved settings. It has no
  behavior beyond `is_printing()`, which is true when no `--exec` command is set.

No other module reads the raw `Opts` after `construct_config` has consumed it. The walker,
filters, and output code only see `Config` and the compiled regexes.

## Startup sequence

`run()` in `src/main.rs` executes these steps in order:

1. Parse `Opts` with clap. When the `completions` feature is enabled and
   `--gen-completions` is present, it prints a shell completion script and returns.
2. Apply `--base-directory` by changing the process working directory, after checking
   that the path is an existing directory.
3. Resolve search roots with `Opts::search_paths`. Missing or non-directory roots are
   reported with `print_error` and dropped; if nothing survives, the run stops with
   "No valid search paths given."
4. Reject patterns that look like paths unless `--full-path` is set (see below).
5. Translate every pattern (the positional pattern plus each `--and` expression) into a
   regex source string with `build_pattern_regex`.
6. Build the `Config` with `construct_config`.
7. Reject patterns that only match leading-dot names when hidden files are excluded.
8. Compile each pattern into a `regex::bytes::Regex` with `build_regex`, using the
   computed case sensitivity.
9. Call `walk::scan(&search_paths, regexps, config)`.

Steps 4, 7, and 8 are the only places where user input is rejected before traversal.
Errors from any step surface through `anyhow` and are printed by `main` with exit
code `GeneralError`.

## Pattern modes

`build_pattern_regex` chooses one of four translations for each pattern. The checks are
ordered, so the first match wins:

| Condition | Translation |
| --- | --- |
| `--glob` and the pattern is non-empty | The glob is compiled with `literal_separator(true)` and its regex form is used. |
| `--exact` | The regex-escaped pattern is anchored as `^...$`. |
| `--fixed-strings` | The pattern is regex-escaped, so it matches as a substring. |
| otherwise | The pattern is used verbatim as a regular expression. |

Because the translation happens per pattern, `--glob` or `--fixed-strings` apply to
every `--and` expression as well.

### Smart case

Case sensitivity is computed in `construct_config`:

- `--ignore-case` always wins and forces case-insensitive matching.
- Otherwise the search is case-sensitive if `--case-sensitive` is set, or if any compiled
  pattern contains an uppercase character. `pattern_has_uppercase_char` inspects the
  parsed regular expression (literals and character-class bounds), not the raw string.
- Otherwise the search is case-insensitive. The regexes are later built with
  `case_insensitive(!config.case_sensitive)`.

### Multiple patterns

The positional pattern and every `--and` expression are compiled into separate regexes.
The walker treats an entry as a match only when all of them match the entry's file name
(or full path with `--full-path`); the join is performed in `walk.rs`, not here.

## Validation guards

Two checks protect against silent empty results:

- **Path-like patterns.** `ensure_search_pattern_is_not_a_path` rejects any pattern that
  contains `/`, because fd matches file names by default and a slash can never match.
  The error suggests `fd . '<dir>'` or `fd --full-path`. On Windows, a native `\` is
  rejected only when the pattern names an existing directory, because `\` is also the
  regex escape character.
- **Leading-dot patterns with hidden files excluded.** On Unix, if `Config::ignore_hidden`
  is set and a pattern is recognized as a start-anchored literal dot (`^\.`),
  `ensure_use_hidden_option_for_leading_dot_pattern` fails and suggests `-H`. The check
  uses `pattern_matches_strings_with_leading_dot` from `src/regex_helper.rs`, which detects
  only that simplest form; other patterns that match only dot-files are not caught.

Both guards are skipped or relaxed as described above; neither is applied by the walker.

## Ignore and visibility wiring

`construct_config` converts ignore-related flags into booleans on `Config`. The rules are
mostly negations of the matching `--no-*` flags:

- `ignore_hidden` is false only with `--hidden`, or with the ripgrep-compatible `-u`
  alias (`rg_alias_ignore`).
- `read_fdignore` and `read_vcsignore` are false with `--no-ignore`, and `-u` also
  disables them. `--no-ignore-vcs` disables only `read_vcsignore`.
- `require_git_to_read_vcsignore` is false only with `--no-require-git`.
- `read_parent_ignore` is controlled by `--no-ignore-parent`.
- `read_global_ignore` also honors `--no-global-ignore-file`.

Custom ignore files from `--ignore-file` and the exclude patterns from `--exclude` are
stored as `ignore_files` and `exclude_patterns` (each exclude is prefixed with `!`).
The walker turns them into `ignore` crate builders; see
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Parallel Traversal](/openwiki/architecture/parallel-traversal.md).

## Output resolution

- **Color.** `ColorWhen::Auto` enables color only when stdout is a terminal, `NO_COLOR` is
  unset or empty, and ANSI support is available. On Windows, ANSI support is probed with
  `nu_ansi_term`. When color is on, `LS_COLORS` from the environment is used if present,
  and the built-in `DEFAULT_LS_COLORS` string otherwise.
- **Hyperlinks.** `HyperlinkWhen::Auto` follows the resolved color setting.
- **Path separator.** `--path-separator` overrides the platform default from
  `filesystem::default_path_separator`. On Windows the value must be exactly one byte.
- **Leading `./`.** `strip_cwd_prefix` is true only when no search path was given, and
  then by default unless the output is null-separated or `--exec` is used.

## Execution and limits

- **`--exec` / `--exec-batch` / `-l`.** `extract_command` takes the parsed command set. With
  `--list-details` and no explicit command, it builds an `ls` invocation: GNU `ls` on
  Linux, `gls` or BSD `ls` on macOS and the BSDs, and GNU `ls` on Windows only when it is
  installed. Other platforms reject the flag.
- **Threads.** `Opts::threads` returns `-j` if given, otherwise the available parallelism
  capped at 64 (`default_num_threads`), and never less than 1.
- **Depth.** `max_depth` and `min_depth` are both set by `--exact-depth` when the
  individual flags are absent.
- **Result cap.** `max_results` returns `--max-results`, or 1 with `--max-one-result`,
  ignoring a value of 0.

## Extension seams

To add a flag, add a field to `Opts` in `src/cli.rs`, add any derived helper method
there, and map the value into a new `Config` field inside `construct_config`. Filters
that need compiled state (for example `--extension`, which becomes a `RegexSet`) are built
in `construct_config` and stored on `Config`. Keep derived decisions in `construct_config`
so the walker stays free of flag parsing.

## Tests

Integration tests in `tests/tests.rs` cover the validation guards (for example
`test_pattern_with_forward_slash_is_rejected` and the `--and` variant) and the
`--full-path` escape hatch. Unit tests in `src/regex_helper.rs` cover uppercase
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
detection and leading-dot detection. See [Testing Strategy](/openwiki/testing/test-strategy.md).

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md)
<!-- openwiki: broken internal link [/openwiki/concepts/pattern-matching.md] link "/openwiki/concepts/pattern-matching.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Pattern Matching Modes](/openwiki/concepts/pattern-matching.md)
<!-- openwiki: broken internal link [/openwiki/concepts/exit-codes-and-errors.md] link "/openwiki/concepts/exit-codes-and-errors.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Exit Codes and Error Reporting](/openwiki/concepts/exit-codes-and-errors.md)
