---
type: concept
title: Exit Codes and Error Handling
description: Meaning of fd's process exit codes (0, 1, 130), how --quiet maps results to exit status, how exit codes from parallel commands are merged, how SIGINT is re-raised, and how errors are reported to stderr.
tags: [exit-codes, errors, sigint, stderr, quiet]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:22.809Z
sources:
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
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
generated: { by: "claude-code", at: "2026-11-16T16:28:22.809Z" }
---

# Exit Codes and Error Handling

## `ExitCode`

`src/exit_codes.rs` defines the internal outcome type used by the walker, receivers and command execution:

| Variant | Integer | Produced by |
|---------|---------|-------------|
| `Success` | 0 | Normal completion (including "no results" when not in quiet mode) |
| `HasResults(true)` | 0 | `--quiet` and at least one match |
| `HasResults(false)` | 1 | `--quiet` and no match |
| `GeneralError` | 1 | Setup errors, output write/flush failures, failed or missing commands |
| `KilledBySigint` | 130 | Ctrl-C observed during printing |

Note that a normal search with zero results exits with **0**; only `--quiet` (`-q`, alias `--has-results`) turns "no results" into exit status 1.

`ExitCode::exit()` calls `process::exit`. On Unix, for `KilledBySigint` it first resets the SIGINT disposition to default and `raise`s SIGINT, so the parent shell sees a genuine signal death instead of just status 130 (falling back to `exit(130)` if the raise does not terminate the process).

## Merging exit codes

`merge_exitcodes` returns `GeneralError` if **any** input is an error (non-zero), else `Success`. Because `KilledBySigint` maps to 130, it is also collapsed into `GeneralError` when merged. It is used:

- across the parallel `--exec` job threads (`walk.rs` `receive`),
- inside each job thread across successive commands (`exec::job`),
- across multiple `--exec-batch` command builders (`CommandSet::execute_batch`).

So with `--exec`, fd exits 1 if any spawned command failed, even if others succeeded.

## Where errors come from

### Setup errors (fatal)

Anything returned as `anyhow::Error` from `run()` — invalid regex, malformed size/time/owner value, invalid `--base-directory`, path-like pattern, leading-dot pattern without `-H`, no valid search paths, unsupported `--list-details` platform, malformed `--exclude` glob — is printed by `main` with `{err:#}` (anyhow context chain) and exits with `GeneralError`. clap usage errors are handled by clap itself before `run` gets that far.

### Non-fatal reports

- Search paths that are not directories: printed (`Search path '...' is not a directory.`) and skipped.
- Malformed patterns in the global ignore file or a `--ignore-file`: printed; partial errors are silently tolerated.
- Filesystem errors encountered during traversal (permission denied, etc.) travel as `WorkerResult::Error` and are printed **only** with `--show-errors`; otherwise they are silently dropped and do not affect the exit code.

### Output errors

- Broken pipe while writing an entry is ignored; other write errors print `Could not write to output: ...` and yield `GeneralError`.
- A failed `flush` (typically the reader closed the pipe) stops the receiver with `GeneralError`, quietly.

### Command errors

`exec::command::handle_cmd_error` prints `Command not found: <program>` for `NotFound`, otherwise `Problem while executing command: ...`, and returns `GeneralError`. A command that exits with a non-zero status also yields `GeneralError` (its buffered output is still written first). See [Command Execution](../systems/command-execution.md).

## `print_error`

`src/error.rs` writes `[fd error]: <msg>` to stderr. If stderr is a terminal, the message passes through `sanitize::maybe_sanitize`, so attacker-controlled filenames embedded in error messages cannot inject terminal escape sequences (the same protection used for stdout — see [Output Rendering](../systems/output-rendering.md)).

## Tests

Unit tests in `src/exit_codes.rs` pin `merge_exitcodes` behavior (empty → `Success`; any error or `KilledBySigint` → `GeneralError`). Integration tests such as `test_quiet`, `test_exec` (failing commands), `test_number_parsing_errors` and `test_invalid_cwd` in `tests/tests.rs` check exit status and stderr through the `TestEnv::assert_failure_with_error`, `assert_failure` and `assert_error` helpers (see [Test Suite](../testing/test-suite.md)).

Related: [Parallel Walk Pipeline](../architecture/parallel-walk-pipeline.md) for where the receiver decides its exit code.
