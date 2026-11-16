---
type: reference
title: CLI Options Reference and Argument Model
description: How fd's command-line interface is defined with clap derive in src/cli.rs — option families and where each is consumed, negation/override flags, conflicts, aliases and hidden options, derived helpers such as threads and max_results, the hand-rolled exec arguments, and shell completions and man page upkeep.
tags: [cli, clap, options, reference, completions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
sources:
  - id: openwiki-source-a358d73a1506937312dd753a
    resource: repo://contrib/completion/_fd
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# CLI Options Reference and Argument Model

All options are defined on `pub struct Opts` in `src/cli.rs` using clap's derive
API (`#[derive(Parser)]`). The struct is consumed once in `main.rs`
`construct_config`, which turns it into `Config`
([Search Pipeline](../architecture/search-pipeline.md)). For full user-facing
text, run `fd --help` or see `doc/fd.1`; this page explains the *model*.

## Command-level settings

`#[command(...)]` sets `name = "fd"`, version from Cargo, a 98-column max help
width, and **`args_override_self = true`** — repeating a single-valued flag keeps
the last value instead of erroring. An `ArgGroup` named `execs` (`exec`,
`exec_batch`, `list_details`) conflicts with `max_results`, `quiet`, and
`max_one_result`.

## Option families and where they go

| Family | Options | Consumed by |
| --- | --- | --- |
| Ignore/hidden | `-H`, `-I`, `--no-ignore-vcs`, `--no-require-git`, `--no-ignore-parent`, `--no-global-ignore-file` (hidden), `-u`, `-E/--exclude`, `--ignore-file`, `--ignore-contain` | [Ignore Rules](../concepts/ignore-rules-and-hidden-files.md) |
| Pattern | positional `<pattern>`, `-s`, `-i`, `-g`, `--regex`, `-F/--literal`, `--exact`, `--and`, `-p/--full-path` | [Pattern Matching](../concepts/pattern-matching.md) |
| Filters | `-d/--max-depth` (`--maxdepth`), `--min-depth` (`--mindepth`), `--exact-depth`, `--prune`, `-t/--type`, `-e/--extension`, `-S/--size`, `--changed-within`, `--changed-before`, `-o/--owner` (Unix) | [Entry Filters](../concepts/entry-filters.md) |
| Traversal | `-L/--follow` (`--dereference`), `--one-file-system` (`--mount`, `--xdev`), `-j/--threads` | [Parallel Walk](../architecture/parallel-walk-and-receiver.md) |
| Output | `-a/--absolute-path`, `-l/--list-details`, `-0/--print0`, `-c/--color`, `--hyperlink` (`--hyper`), `--format`, `--path-separator`, `--strip-cwd-prefix`, `--show-errors` | [Output Formatting](../features/output-formatting.md) |
| Execution | `-x/--exec`, `-X/--exec-batch`, `--batch-size` | [Command Execution](../features/command-execution.md) |
| Result limits | `--max-results`, `-1`, `-q/--quiet` (`--has-results`) | [Parallel Walk](../architecture/parallel-walk-and-receiver.md) |
| Paths | positional `<path>...`, `--search-path`, `-C/--base-directory` | [Search Pipeline](../architecture/search-pipeline.md) |
| Hidden/internal | `--max-buffer-time` (ms), `--gen-completions` | receiver buffering; completions |

## Negation flags

Many boolean flags have a hidden opposite declared as a `()` field with
`action = SetTrue` and `overrides_with`: `--no-hidden`, `--ignore`,
`--ignore-vcs`, `--require-git`, `--ignore-parent`, `--relative-path`,
`--no-follow`. `--regex` overrides `--glob`; `-s`/`-i` override each other;
`--max-results` and `-1` override each other. This lets users put defaults in a
shell alias and override them per invocation.

## Notable conflicts and requirements

- `--glob` ✕ `--fixed-strings`; `--exact` ✕ `--glob`, `--fixed-strings`.
- `--list-details` ✕ `--absolute-path`, `--print0`, `--format`, `--exec`,
  `--exec-batch`; `--exec` ✕ `--exec-batch`.
- `--exact-depth` ✕ `--max-depth`, `--min-depth`; `--prune` ✕ `--size`,
  `--exact-depth`.
- `--quiet` ✕ `--max-results`.
- `--search-path` ✕ positional `<path>`; `--strip-cwd-prefix` ✕ both.
- `--batch-size` requires `--exec-batch`.
- `--strip-cwd-prefix` and `--hyperlink` use `require_equals` (`--hyperlink=always`)
  because their value is optional.

## Derived helpers on `Opts`

- `search_paths()` / `normalize_path()` — choose and validate roots (see Search
  Pipeline).
- `max_depth()` / `min_depth()` — fall back to `exact_depth`.
- `threads()` — `-j` value or `available_parallelism()` capped at 64, falling
  back to 1 if unknown. The value sizes both walker threads and `--exec` job
  threads.
- `max_results()` — `--max-results` if > 0 (so `0` means unlimited), else 1 for
  `-1`, else none.
- `strip_cwd_prefix(auto_pred)` — only when no paths were given; `auto` defers to
  the predicate supplied by `construct_config`.
- `rg_alias_ignore()` — true if `-u` was given any number of times.
- `gen_completions()` — explicit shell, or detected via `Shell::from_env()`.

## Value parsers and enums

`-S` uses `SizeFilter::from_string`, `-o` uses `OwnerFilter::from_string`, `-j`
parses `NonZeroUsize`, `--max-buffer-time` parses milliseconds. Value enums:
`FileType` (with single-letter aliases), `ColorWhen` (`auto|always|never`),
`StripCwdWhen`, `HyperlinkWhen`. Time values are kept as strings and parsed later
in `construct_config`, so their errors are fd errors rather than clap errors.

## `Exec` arguments

`Exec` is a manual `clap::Args`/`FromArgMatches` implementation flattened into
`Opts`, because the derive API cannot return grouped occurrences. See
[Command Execution](../features/command-execution.md).

## Completions and man page

- `--gen-completions [shell]` (hidden, exclusive; requires the default
  `completions` feature) prints a clap-generated script. The Makefile uses it for
  bash, fish and PowerShell.
- zsh completions (`contrib/completion/_fd`, based on ripgrep's) and the `fdfind`
  variants are maintained by hand, as is `doc/fd.1`; new options need manual
  updates there. The README help section is refreshed with
  `scripts/update-help.awk` during releases
  ([Build, CI, Release](../operations/build-release-and-packaging.md)).

## Adding an option

1. Add the field (with doc comment as help text) to `Opts`.
2. Add conflicts/overrides as needed.
3. Map it into a `Config` field in `construct_config`.
4. Consume it in `walk.rs`, `output.rs`, or `exec/`.
5. Update `doc/fd.1`, `contrib/completion/_fd`, the README, `CHANGELOG.md`, and
   add tests in `tests/tests.rs`.
