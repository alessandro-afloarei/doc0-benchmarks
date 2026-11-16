---
type: workflow
title: Command Execution (--exec and --exec-batch)
description: How fd turns --exec and --exec-batch command templates into child processes, runs them one result at a time on a thread pool or in batched argument lists on a single thread, buffers captured output, and merges child failures into fd's exit status.
tags: [exec, exec-batch, subprocess, threads, batching, output-buffering, exit-codes]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-47d76f6cde81cde2b78e68be
    resource: repo://src/exec/mod.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Command Execution (--exec and --exec-batch)

`fd` can run a command for each result instead of printing it. Two options select the
mode: `-x`/`--exec` runs the command once per result, and `-X`/`--exec-batch` collects
results and runs the command with many arguments at once. This page covers how templates
are built, how each mode runs, how output is handled, and how failures reach the exit
code. The code lives in `src/exec/` and is invoked from the receiver in `src/walk.rs`.

## Template construction

`CommandSet::new` (for `--exec`) and `CommandSet::new_batch` (for `--exec-batch`) turn the
argument lists collected by `Exec::from_arg_matches` into `CommandTemplate` values. Each
argument is parsed with `FormatTemplate::parse` (see
<!-- openwiki: broken internal link [/openwiki/workflows/output-and-formatting.md] link "/openwiki/workflows/output-and-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Output and Formatting](/openwiki/workflows/output-and-formatting.md) for the placeholder
syntax), and the following checks apply:

- An empty command is an error: "No executable provided for --exec or --exec-batch".
- In batch mode, the program name must be fixed. A placeholder in position 0 is rejected.
- In batch mode, each command may contain at most one placeholder token.
- If no argument contains a placeholder, the template appends one `{}` at the end, so the
  path is always passed as the last argument.

`-x` takes arguments up to a terminating `;`, while `-X` uses the same syntax and
accepts `--batch-size`, which caps the number of arguments per invocation. A value of
zero, the default, means no cap beyond the operating system's command-line length limit.

## One-result-at-a-time mode

For each entry, the job path calls `CommandSet::execute`:

1. Every template in the set is generated for that single path with `generate`.
2. `execute_commands` runs them in order. The first command that fails ends the sequence
   for that path, so later commands in the same `--exec` set do not run for it.
3. Output is captured with `cmd.output()` when more than one thread is in use, so that
   results from different jobs are not interleaved. With a single thread, the child inherits
   the terminal through `spawn` and `wait_with_output`, which allows interactive commands.

Parallelism comes from `receive`, which starts `config.threads` job threads, each reading from
the same bounded channel of batches. The order of execution across results is therefore not
defined. The `--exec` help text says so explicitly, and it recommends `--threads=1` when
order matters.

### Output buffering

`OutputBuffer` holds stdout and stderr for each command while it runs. The buffer is written
out after the command completes. On failure, it is written immediately before the function
returns, so the captured diagnostic output is not lost. With `-0`/`--print0` (the null-separator
mode), the buffer also appends a NUL byte after each entry, so downstream tools can split
output reliably.

## Batch mode

`-X` takes a different path. Because the receiver is a single thread, `exec::batch` gathers
every path into a `CommandBuilder` per template:

- Each builder keeps the prefix arguments (everything before the placeholder), the
  placeholder template, and the suffix arguments.
- A path is appended to the current child command until either the batch-size limit is hit or
  `args_would_fit` says that adding the next argument would exceed the operating system's
  argument-length limit. In either case the current command is run, and a new one starts.
- Commands in batch mode inherit stdin, stdout, and stderr, so their output is not captured
  or reordered. This is intentional, because results may be large and streaming.
- After the last path, `finish` runs any partial batch.

Each batch's success or failure is recorded in `CommandBuilder::exit_code`. A failing batch
does not stop later batches. The final code is the merge of all builders.

## Exit status

Child exit status affects fd's own status, but fd does not forward the child's number:

- A child that exits non-zero, in either mode, makes that job or batch report `GeneralError`.
- A child that cannot be started produces an error message through `handle_cmd_error`. A
  missing program prints "Command not found: <program>". Any other failure prints "Problem while
  executing command". Both map to `GeneralError`.
- `merge_exitcodes` combines results across jobs, so any failure makes the whole run return
<!-- openwiki: broken internal link [/openwiki/concepts/exit-codes-and-errors.md] link "/openwiki/concepts/exit-codes-and-errors.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  `GeneralError`. See [Exit Codes and Error Reporting](/openwiki/concepts/exit-codes-and-errors.md).

## Interaction with other options

- `--max-results`, `--quiet`, and `--max-one-result` conflict with the `--exec` family in
  `cli.rs`, so they cannot be combined with these options.
- `--format` is parsed alongside `--exec`, but it only affects printed output
  (`output::print_entry`). When a command is set nothing is printed, so the template has no
  effect.
- Entries that are filtered out before the send never reach the command. See
<!-- openwiki: broken internal link [/openwiki/workflows/filtering-entries.md] link "/openwiki/workflows/filtering-entries.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  [Filtering Entries](/openwiki/workflows/filtering-entries.md).
- The `--list-details` option is implemented as a built-in batch command using `ls`, so it shares
  this code path and the same exit-status rules.

## Invariants and gotchas

- In one-at-a-time mode, command order across results is not guaranteed.
- A single path's command sequence stops at the first failure, but other paths keep going.
- Batch mode is always single-threaded, which keeps the argument lists deterministic.
- Shell syntax is not interpreted. Templates are executed directly, so quoting belongs to the
  user's shell, not to fd.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Parallel Traversal](/openwiki/architecture/parallel-traversal.md)
<!-- openwiki: broken internal link [/openwiki/workflows/output-and-formatting.md] link "/openwiki/workflows/output-and-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Output and Formatting](/openwiki/workflows/output-and-formatting.md)
<!-- openwiki: broken internal link [/openwiki/concepts/exit-codes-and-errors.md] link "/openwiki/concepts/exit-codes-and-errors.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Exit Codes and Error Reporting](/openwiki/concepts/exit-codes-and-errors.md)
