---
type: operations
title: Exit Codes, Errors and Signals
description: Covers what exit status fd returns and why. Includes the ExitCode variants and their numeric values, how per-command codes are merged, --quiet result signaling, SIGINT handling and re-raising, the [fd error] message format, filesystem errors with --show-errors, and broken-pipe behavior.
tags: [exit-codes, errors, signals, sigint, quiet, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# Exit Codes, Errors and Signals

## ExitCode model

`src/exit_codes.rs` defines a small enum that every subsystem returns:

| Variant | Status | Produced when |
| --- | --- | --- |
| `Success` | 0 | Normal completion, **even if nothing matched** (without `--quiet`). Also when all exec commands succeed |
| `HasResults(true)` | 0 | `--quiet` and at least one match |
| `HasResults(false)` | 1 | `--quiet` and no match |
| `GeneralError` | 1 | Any error returned from `run()`, output write or flush failures, a failed exec command, or a command that could not be spawned |
| `KilledBySigint` | 130 | Interrupted by Ctrl-C (see below) |

`merge_exitcodes` folds several codes into one. If **any** of them is non-zero, including `KilledBySigint` and `HasResults(false)`, the result is `GeneralError`. Otherwise it is `Success`. This is used to combine exit codes from parallel exec job threads, from several commands in one `CommandSet`, and from batch builders.

Scripts that need "found something?" semantics should use `-q/--quiet` (alias `--has-results`). Without it, fd exits 0 when there are no results. `--quiet` conflicts with `--max-results` and the exec options.

## Error reporting

- `error::print_error(msg)` writes `[fd error]: <msg>` to stderr. The message is sanitized against terminal escape injection when stderr is a terminal (see [Output Formatting](../concepts/output-formatting.md)).
- **Fatal errors**: anything that bubbles up as `anyhow::Error` from `run()` is printed with `{err:#}`, which includes the cause chain, and the process exits with `GeneralError`. Examples: an invalid regex, a path-like pattern, an invalid time spec, no valid search paths, a bad `--base-directory`, or `--list-details` on an unsupported platform.
- **Non-fatal warnings** are printed and the run continues. Examples: a search path that is not a directory (it is dropped), and malformed patterns in the global or custom ignore files.
- **Filesystem errors during the walk**, such as permission denied, are sent through the channel as `WorkerResult::Error`. They are only printed when `--show-errors` is set, both in print mode and in exec mode. Either way they do not change the exit code.
- **clap errors**, such as unknown flags or conflicting options, are reported by clap with its own exit status before fd's logic runs.

## Exec failures

`exec::command::execute_commands` returns `GeneralError` when:

- a command exits with a non-zero status, or is killed by a signal (`status.code() != Some(0)`), or
- spawning fails. A `NotFound` spawn error prints `Command not found: <program>`. Any other spawn error prints `Problem while executing command: <err>`.

Within one `CommandSet` (several `-x` options), the commands for an entry run in order. The **first failure stops** the remaining commands for that entry. Any buffered output is still written. Batch mode marks the builder as failed but keeps processing later chunks. See [Command Execution](../workflows/command-execution.md).

## Broken pipes

When printing, an `io::ErrorKind::BrokenPipe` from `print_entry` is ignored, so `fd | head` does not print an error. Any other write error prints `Could not write to output: ...` and returns `GeneralError`. A failed `flush()`, which usually also means a broken pipe, returns `GeneralError` silently.

## SIGINT

- fd only installs a Ctrl-C handler when it is printing colorized output. In that mode, the first Ctrl-C asks the walk and receiver to stop at the next printed entry, so a half-written ANSI color sequence does not leave the terminal in a bad state. A second Ctrl-C exits immediately. In all other modes SIGINT keeps its default action (see [Parallel Search Pipeline](../architecture/search-pipeline.md)).
- `ExitCode::KilledBySigint.exit()` on Unix resets the SIGINT disposition to default and **re-raises SIGINT** on itself. The parent shell therefore sees a real signal death and not just status 130. If raising fails, it falls back to `process::exit(130)`. On non-Unix platforms it exits with status 130.

## Tests

The unit tests in `src/exit_codes.rs` cover the merge rules. Integration tests in `tests/tests.rs` check `--quiet` exit status in `test_quiet`, using the `TestEnv::assert_failure_with_error` and `assert_output` helpers.
