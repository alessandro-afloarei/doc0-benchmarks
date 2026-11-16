---
type: reference
title: Exit Codes and Error Reporting
description: fd's ExitCode model and numeric exit statuses, how codes from parallel workers and commands are merged, SIGINT re-raising, --quiet semantics, the [fd error] message format, filesystem error visibility, and broken-pipe handling.
tags: [exit-codes, errors, signals, reference]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
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
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Exit Codes and Error Reporting

## The `ExitCode` model

`src/exit_codes.rs` defines:

| Variant | Status | Meaning |
| --- | --- | --- |
| `Success` | 0 | Normal completion (whether or not anything matched). |
| `HasResults(true)` | 0 | `--quiet`: at least one match. |
| `HasResults(false)` | 1 | `--quiet`: no match. |
| `GeneralError` | 1 | Any failure: invalid arguments/config, output write error, failed or missing command. |
| `KilledBySigint` | 130 | Interrupted by Ctrl-C. |

Note that a normal search with zero results exits 0; only `--quiet` (alias
`--has-results`) turns "no results" into status 1.

`ExitCode::exit()` calls `process::exit`. For `KilledBySigint` on Unix it first
resets the SIGINT handler to the default and re-raises SIGINT, so the parent shell
sees a genuine signal death (important for scripts and shells that stop loops on
Ctrl-C). If that fails, it falls back to status 130.

`merge_exitcodes` collapses many codes into one: if any is an error (non-zero
status), the result is `GeneralError`, otherwise `Success`. It is used to combine
multiple `--exec` job threads, multiple commands per entry, and multiple batch
command builders. An empty set merges to `Success`.

## Where codes originate

- **Before the scan** — every validation failure in `run()` is an `anyhow::Error`;
  `main` prints it with its context chain (`{err:#}`) and exits with
  `GeneralError`. See [Search Pipeline](../architecture/search-pipeline.md).
- **Receiver** — returns `Success` / `HasResults(..)` when the channel closes or
  `--max-results` is reached; `GeneralError` on a non-broken-pipe write error or a
  failed flush; `KilledBySigint` after an interrupt. See
  [Parallel Walk](../architecture/parallel-walk-and-receiver.md).
- **Commands** — a non-zero exit, a signal-terminated command, or a spawn failure
  yields `GeneralError` ([Command Execution](../features/command-execution.md)).
- **`scan`** — overrides the receiver's result with `KilledBySigint` whenever the
  interrupt flag was set.

## Error messages

`error::print_error` writes `[fd error]: <message>` to stderr. When stderr is a
terminal, the message is sanitized so file names in errors cannot inject escape
sequences ([Output Formatting](../features/output-formatting.md)). Non-fatal
warnings use the same function, for example:

- a search path that is not a directory (that path is skipped);
- a malformed pattern in the global or a custom ignore file;
- "Command not found: <program>" or "Problem while executing command: ...".

## Filesystem errors

Walker errors (permission denied, I/O errors, symlink loops) travel as
`WorkerResult::Error` and are silently dropped unless `--show-errors` is given.
The exception is a dangling symlink, which is turned into a broken-symlink
result rather than an error.

## Broken pipes

When stdout is closed early (e.g. `fd ... | head`), a `BrokenPipe` from writing
an entry is not reported as an error, but the following flush fails and the
receiver returns `GeneralError` quietly, which stops the walk via the quit flag.

## Tests

`src/exit_codes.rs` unit tests check `merge_exitcodes` (empty → success, any
error → general error). Integration tests use `TestEnv::assert_failure`,
`assert_error`, and `assert_failure_with_error` to check failing runs
([Test Suite](../testing/test-suite.md)).
