---
type: system
title: Command Execution (--exec / --exec-batch)
description: How fd runs external commands for search results - command template parsing and placeholders, parallel one-by-one execution with per-entry output buffering, batch execution split by argument-size limits and --batch-size, the --list-details ls command, and exit status merging.
tags: [exec, exec-batch, commands, placeholders, argmax, list-details, parallelism]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:22.809Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-47d76f6cde81cde2b78e68be
    resource: repo://src/exec/mod.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T16:28:22.809Z" }
---

# Command Execution (`--exec` / `--exec-batch`)

Code: `src/exec/mod.rs` (types and batch builder), `src/exec/job.rs` (receiver loops), `src/exec/command.rs` (spawning and output buffering), placeholder parsing in `src/fmt/mod.rs`.

## Command templates

`-x/--exec` and `-X/--exec-batch` are declared in the hand-written `Exec` clap group (`src/cli.rs`). Each takes one or more values, allows hyphenated values and ends at a literal `;` (`\;` in shells). They may be repeated; each occurrence becomes one `CommandTemplate`, and all are collected in one `CommandSet` with an `ExecutionMode` of `OneByOne` or `Batch`. `--exec` and `--exec-batch` are mutually exclusive and both conflict with `--list-details`, `--max-results`, `-1` and `--quiet`.

Because all following positional arguments belong to the command, the help text recommends placing `-x` last.

<!-- openwiki: broken internal link [output-rendering.md#format-templates] heading anchor "format-templates" does not exist in "output-rendering.md". Fix the href or restore the target, then delete this comment. -->
`CommandTemplate::new` parses every argument with `FormatTemplate::parse` (see [Output Rendering](output-rendering.md#format-templates)):

| Placeholder | Meaning |
|-------------|---------|
| `{}` | path |
| `{/}` | basename |
| `{//}` | parent directory (`.` if none) |
| `{.}` | path without extension |
| `{/.}` | basename without extension |
| `{{`, `}}` | literal `{`, `}` |

Rules enforced at parse time:

- At least one argument is required (`No executable provided for --exec or --exec-batch`).
- If no argument contains a placeholder, an implicit `{}` argument is appended.
- In batch mode the executable (first argument) must not be a placeholder, and at most **one** argument may contain placeholders (`Only one placeholder allowed for batch commands`). In one-by-one mode `fd -x {}` (running each result) is allowed.

`--path-separator` is applied to placeholder expansions only, never to fixed text.

## Which path is passed

Commands receive `DirEntry::stripped_path`. Because `--strip-cwd-prefix=auto` does **not** strip when a command is configured, a search without explicit paths passes `./a.foo`-style paths (safe for file names starting with `-`). `--strip-cwd-prefix` forces `a.foo`; `{.}`/`{/.}` already drop the `./` via `remove_extension`. With `-a`, absolute paths are passed.

## One-by-one mode (`--exec`)

The walker's receiver spawns `threads` scoped job threads, each consuming the shared channel and calling `exec::job` (see [Parallel Walk Pipeline](../architecture/parallel-walk-pipeline.md#receiver-side-commands)). Senders use batch size 1 in this mode so entries spread evenly across jobs. There is **no ordering guarantee** between results.

For each entry, `CommandSet::execute` generates every template's command and runs them sequentially via `execute_commands`:

- **Multi-threaded (`threads > 1`)**: commands run with `output()`, capturing stdout/stderr into an `OutputBuffer`. After all commands for the entry finish (or one fails), the buffer is written while holding both the stdout and stderr locks, so output of different entries never interleaves.
- **Single-threaded (`-j1`)**: commands are `spawn`ed with inherited stdio and waited on, so intermediate output and interactive programs work; execution is sequential.
- With `--print0`, a `\0` is written after each entry's output.
- The first command that fails to spawn or exits non-zero stops the remaining commands for that entry and makes the entry's result `GeneralError`; the job keeps processing further entries.

## Batch mode (`--exec-batch`, `--list-details`)

The receiver thread itself runs `exec::batch`, which converts entries into stripped `PathBuf`s and calls `CommandSet::execute_batch(paths, config.batch_size, separator)`.

Each template becomes a `CommandBuilder` that splits its args into `pre_args` (before the placeholder), the single `path_arg` template, and `post_args`. For every path:

1. If `--batch-size` (`limit`, default 0 = unlimited) is reached, the current command is run (`finish`).
2. If the expanded argument plus `post_args` would not fit the OS argument limit (`argmax::Command::args_would_fit`), the current command is run first.
3. The argument is appended.

At the end every builder is finished. So one logical `-X` may run as several processes when results exceed `ARG_MAX` or `--batch-size`. Batch commands inherit stdin/stdout/stderr (no buffering); a non-zero exit marks `GeneralError` but later batches still run. Spawn errors abort with `handle_cmd_error`. Argument order is nondeterministic.

`--batch-size` requires `--exec-batch` at the clap level.

## `--list-details` (`-l`)

`extract_command` in `src/main.rs` synthesizes a batch `CommandSet` from `determine_ls_command`:

- Linux and other non-BSD Unix: `ls -l -h -d --color=always|never` (short options for BusyBox compatibility), color following fd's color decision.
- macOS / FreeBSD / DragonFly / NetBSD / OpenBSD: GNU `gls` with the same options if `gls --version` runs, else BSD `ls -l -h -d`, plus `-G` for color except on NetBSD/OpenBSD.
- Windows: GNU `ls` if available, else an error; other platforms error out.

`-l` conflicts with `--absolute-path`, `--print0` and `--format`.

## Exit status

Per-entry, per-job and per-builder results are combined with `merge_exitcodes`, so fd exits 1 if any command failed and 0 otherwise. Error messages and codes are described in [Exit Codes and Error Handling](../concepts/exit-codes-and-errors.md).

## Tests

- Unit tests in `src/exec/mod.rs`: placeholder tokenization, brace escaping, implicit `{}`, batch placeholder limits, empty-template rejection, and `--path-separator` substitution (including Windows UNC/drive prefixes).
- Integration tests in `tests/tests.rs`: `test_exec`, `test_exec_multi`, `test_exec_nulls`, `test_exec_batch`, `test_exec_batch_multi`, `test_exec_batch_with_limit`, `test_exec_with_separator`, `test_exec_invalid_utf8`, `test_list_details`, `test_single_and_multithreaded_execution`.
