---
type: architecture
title: Command Execution and Placeholder Templates
description: How fd runs external commands for search results via --exec (-x), --exec-batch (-X) and --list-details (-l), and how the shared placeholder template engine ({}, {/}, {//}, {.}, {/.}) also powers --format.
tags: [exec, exec-batch, placeholders, templates, concurrency, exit-codes]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T06:14:47.054Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-47d76f6cde81cde2b78e68be
    resource: repo://src/exec/mod.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-82ad9015e8518df8ee697487
    resource: repo://src/fmt/mod.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-15T06:14:47.054Z" }
---

# Command Execution and Placeholder Templates

fd can hand search results to external programs instead of printing them. The
`exec` module (`src/exec/`) owns command construction and process spawning;
the `fmt` module (`src/fmt/`) owns the placeholder template language that both
`--exec`/`--exec-batch` arguments and `--format` strings use. The search walk
itself is described in [Search Pipeline](search-pipeline.md); this page starts
where results leave the walker's channel.

## Entry points and modes

| Flag | Mode | Construction |
| --- | --- | --- |
| `-x`, `--exec <cmd>...` | `ExecutionMode::OneByOne` – one process per result, in parallel | `CommandSet::new` |
| `-X`, `--exec-batch <cmd>...` | `ExecutionMode::Batch` – one process (or a few) for all results | `CommandSet::new_batch` |
| `-l`, `--list-details` | Batch mode with a platform-specific `ls -l` command | `determine_ls_command` in `src/main.rs` |

`Exec` in `src/cli.rs` is a hand-written `clap::FromArgMatches`/`clap::Args`
implementation because clap's derive API cannot expose grouped occurrences.
Both flags are `ArgAction::Append` with `num_args(1..)`, accept hyphen values
and use `;` as a value terminator, so several `-x` occurrences produce several
command templates in one `CommandSet` (they run sequentially for each result).
`--exec-batch` conflicts with `--exec` and `--list-details`. Everything after
`-x` is treated as part of the command, which is why the help recommends
putting `-x` last or terminating with `\;`.

`--list-details` is not a separate executor: `extract_command` in
`src/main.rs` builds `CommandSet::new_batch([ls_cmd])`. On Linux it assumes GNU
`ls -l -h -d --color=always|never`; on macOS/BSD it prefers `gls` when present
and otherwise uses BSD `ls -l -h -d` (with `-G` for colors except on
NetBSD/OpenBSD); on Windows it requires GNU `ls` and errors otherwise.

## Template model

`CommandSet { mode, commands: Vec<CommandTemplate> }` holds one
`CommandTemplate` per `-x`/`-X` occurrence, and each template is a
`Vec<FormatTemplate>`, one per argv element.

`FormatTemplate::parse` (`src/fmt/mod.rs`) uses a lazily initialized
Aho-Corasick automaton over `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}`:

- `{{` / `}}` are escapes producing a literal brace;
- a placeholder immediately followed by `}` is treated as text (escaped closing
  brace);
- otherwise the match becomes a `Token` (`Placeholder`, `Basename`, `Parent`,
  `NoExt`, `BasenameNoExt`) and surrounding text becomes `Token::Text`.

A string with no placeholders parses to `FormatTemplate::Text`; otherwise it is
`FormatTemplate::Tokens`. `generate(path, path_separator)` substitutes each
token using helpers in `src/fmt/input.rs` (`basename`, `dirname` which returns
`.` for an empty parent, and `remove_extension`), and, when `--path-separator`
is set, rewrites separators inside the substituted path pieces only — fixed
text is never altered. Windows UNC prefixes are re-rendered with the custom
separator.

`CommandTemplate::new` enforces three rules:

1. at least one argument is required ("No executable provided for --exec or
   --exec-batch");
2. in batch mode the first argument (the executable) may not be a placeholder;
3. if no argument contains a placeholder, an implicit `{}` is appended.

`CommandSet::new_batch` additionally rejects templates with more than one
placeholder-bearing argument ("Only one placeholder allowed for batch
commands"), because batch mode expands exactly one argument position per path.

## How results reach the executor

`WorkerState::receive` in `src/walk.rs` decides the receiver side once
`config.command` is set:

- **Batch mode** – the receiver thread calls `exec::batch` directly with the
  flattened channel iterator.
- **One-by-one mode** – it spawns `config.threads` scoped job threads, each
  owning a clone of the crossbeam receiver and running `exec::job`; their exit
  codes are combined with `merge_exitcodes`.

On the sender side, the walker normally batches up to 0x100 results per channel
message, but when running non-batch commands with more than one thread the
batch limit is set to 1 so work spreads evenly across the job threads.

The path passed to commands is `DirEntry::stripped_path(config)`. The
`strip_cwd_prefix` default for commands is *not* to strip: `construct_config`
passes `!(null_separator || has_command)` as the auto predicate, so relative
results keep their `./` prefix with `-x`/`-X`/`-0`, protecting against paths
beginning with `-` being parsed as options. `--strip-cwd-prefix` overrides
this, and `stripped_path` still keeps the prefix for names starting with `-`.

## One-by-one execution (`--exec`)

`exec::job` (`src/exec/job.rs`) loops over `WorkerResult`s, printing
filesystem errors only when `--show-errors` is set, and calls
`CommandSet::execute` for each entry. Output buffering is enabled whenever
`config.threads > 1`.

`execute_commands` (`src/exec/command.rs`) runs every command template for the
entry in order:

- with buffering, it uses `cmd.output()` and stores stdout/stderr in an
  `OutputBuffer`; when all commands finish (or one fails), `OutputBuffer::write`
  locks both stdout and stderr and writes the captured output atomically so
  parallel jobs do not interleave;
- without buffering (`--threads=1`), it spawns with inherited stdio so the user
  can see and interact with intermediate output;
- with `--print0`, a trailing `\0` is written after each entry's output.

A non-zero child status stops the remaining templates for that entry and yields
`ExitCode::GeneralError`; a spawn failure of kind `NotFound` is reported as
"Command not found: <program>". Execution order across results is explicitly
non-deterministic.

## Batch execution (`--exec-batch`, `--list-details`)

`exec::batch` converts results into stripped `PathBuf`s and calls
`CommandSet::execute_batch(paths, config.batch_size, path_separator)`. For each
template a `CommandBuilder` splits arguments into `pre_args`, the single
placeholder `path_arg`, and `post_args`. Each path is rendered through
`path_arg` and appended to an `argmax::Command`. Before appending, the builder
flushes (runs the command and starts a fresh one) when either:

- `--batch-size` is non-zero and that many paths have been added, or
- `args_would_fit` reports that the new argument plus `post_args` would exceed
  the OS command-line length limit.

`finish` appends `post_args`, runs the command with inherited stdio, and marks
the builder's exit code as `GeneralError` on failure. Thus one `-X` invocation
may run the command several times. All builders' codes are merged at the end.

## Exit codes

`merge_exitcodes` (`src/exit_codes.rs`) returns `GeneralError` (1) if any
merged code is an error, otherwise `Success`. fd therefore exits 1 if any
spawned command fails, in either mode.

## `--format` reuse

`--format` is parsed by the same `FormatTemplate::parse` in `construct_config`
and rendered by `print_entry_format` in `src/output.rs`, so the placeholder
syntax and escaping are identical to `--exec`, but no process is spawned.

## Tests

Integration tests in `tests/tests.rs` cover this subsystem: `test_exec`,
`test_exec_multi`, `test_exec_nulls`, `test_exec_batch`,
`test_exec_batch_multi`, `test_exec_batch_with_limit`,
`test_exec_with_separator`, `test_exec_invalid_utf8` and
`test_single_and_multithreaded_execution`. Unit tests for template parsing live
at the bottom of `src/exec/mod.rs` and `src/fmt/mod.rs`, with path helper tests
in `src/fmt/input.rs`.

See also: [Search Pipeline](search-pipeline.md), [Quickstart](../quickstart.md).
