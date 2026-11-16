---
type: architecture
title: Command Execution (--exec, --exec-batch, --list-details)
description: How fd turns search results into external command invocations - format-template placeholders, per-result parallel jobs with buffered output, batch mode bounded by argument limits, exit-code merging, and the ls-based --list-details.
tags: [exec, exec-batch, placeholders, subprocess, concurrency]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
sources:
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
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# Command Execution

When `--exec`/`-x`, `--exec-batch`/`-X` or `--list-details`/`-l` is given, fd does not print results. `Config.command` is `Some(Arc<CommandSet>)` and the receiver side of the pipeline (see [[architecture/parallel-walk-pipeline]]) hands results to the `exec` module instead of the printing `ReceiverBuffer`. The code lives in `src/exec/` (`mod.rs`, `job.rs`, `command.rs`) with the template engine in `src/fmt/`.

## Templates and placeholders (`src/fmt`)

`FormatTemplate::parse` splits an argument into `Token`s using an Aho-Corasick automaton over `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}`:

| Token | Meaning |
| --- | --- |
| `{}` | full path of the result |
| `{/}` | basename |
| `{//}` | parent directory (`.` if empty) |
| `{.}` | path without extension |
| `{/.}` | basename without extension |
| `{{` / `}}` | literal `{` / `}` |

An argument with no placeholder becomes `FormatTemplate::Text`; otherwise `FormatTemplate::Tokens`. `generate` expands tokens into an `OsString` (non-UTF-8 paths are preserved) and, when `--path-separator` is set, rewrites separators inside placeholder expansions only, never in literal text. The path helpers (`basename`, `dirname`, `remove_extension`) are in `src/fmt/input.rs`.

The same `FormatTemplate` is reused for `--format` output (see [[architecture/output-and-terminal-safety]]).

## CommandSet and CommandTemplate (`exec/mod.rs`)

A `CommandSet` holds an `ExecutionMode` (`OneByOne` or `Batch`) and one `CommandTemplate` per `-x`/`-X` occurrence, so several commands can be chained. `CommandTemplate::new` enforces:

- at least one argument (otherwise clap would let fd try to execute every file);
- for batch mode, the program name cannot contain a placeholder;
- if no argument contains a placeholder, an implicit `{}` is appended.

`CommandSet::new_batch` additionally rejects more than one placeholder-bearing argument ("Only one placeholder allowed for batch commands"). The sets are built while parsing the CLI (see [[architecture/cli-and-config]]).

## One-by-one mode: `job`

`walk.rs::receive` spawns `config.threads` scoped worker threads, each running `exec::job` on a clone of the channel receiver. For each `WorkerResult::Entry` the job calls `CommandSet::execute` with `dir_entry.stripped_path(config)`; filesystem errors are printed only if `--show-errors` is set. Per-job exit codes are combined with `merge_exitcodes`, and the thread results are merged again in `receive`.

To spread work evenly, the sender side uses a batch size of 1 when running commands one-by-one with more than one thread, instead of the default 256-item batches.

`execute_commands` runs the commands of one template set in sequence for a single path:

- With more than one thread (`buffer_output = true`) it uses `Command::output()`, collecting stdout/stderr into an `OutputBuffer`; the buffer is written under the stdout and stderr locks so output from different jobs does not interleave. With `--print0`, a `\0` is written after each entry's output.
- With a single thread it spawns and waits without capturing, so interactive commands keep working.
- A non-zero status stops the remaining commands for that path and yields `ExitCode::GeneralError`. A "not found" spawn error prints `Command not found: <program>`; other spawn errors print "Problem while executing command".

## Batch mode: `batch`

`exec::batch` collects all paths from the receiver and calls `CommandSet::execute_batch`. For each command template a `CommandBuilder` splits arguments into `pre_args`, the single placeholder argument and `post_args`. It uses the `argmax` crate: `push` calls `finish()` and starts a new command when `--batch-size` is reached (a limit of 0 means unlimited) or when `args_would_fit` says the OS argument-length limit would be exceeded. `finish` runs the command with inherited stdio if at least one path was pushed, and any non-success status marks that builder's exit code as `GeneralError`. The final exit code merges all builders.

Because batch mode runs one consumer over the whole result stream, results are not sorted and execution order is nondeterministic.

## `--list-details`

`main.rs::extract_command` turns `--list-details` into a batch `CommandSet` running `ls -l -h -d` (GNU `ls`, using `--color=always|never` depending on color settings). On macOS and the BSDs it prefers `gls` if installed, otherwise BSD `ls` with `-G` when colors are on and supported. On Windows it requires a GNU `ls` on `PATH`, else it fails with an explanatory error.

## Exit codes

`merge_exitcodes` in `src/exit_codes.rs` returns `GeneralError` if any job reported a non-zero code (including `KilledBySigint`), else `Success`. fd's own exit status therefore reflects whether any spawned command failed.
