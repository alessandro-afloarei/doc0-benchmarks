---
type: operations
title: Exit Codes, Errors, and Interrupts
description: fd's exit-code contract (0, 1, 130 and --quiet semantics), how exit codes from parallel command jobs are merged, how setup errors, filesystem errors and output errors are reported, broken-pipe behavior, and Ctrl-C/SIGINT handling.
tags: [exit-codes, errors, sigint, quiet, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# Exit Codes, Errors, and Interrupts

## Exit codes (`src/exit_codes.rs`)

`ExitCode` is a small enum converted to a process status by `From<ExitCode> for i32`:

| Variant | Status | When |
|---------|--------|------|
| `Success` | 0 | normal completion — **including searches with no results** |
| `HasResults(true)` | 0 | `--quiet` and at least one match |
| `HasResults(false)` | 1 | `--quiet` and no match |
| `GeneralError` | 1 | setup errors, output errors, failed or missing `--exec` commands |
| `KilledBySigint` | 130 | interrupted by Ctrl-C |

Command-line usage errors (unknown flags, conflicting options, invalid values from value parsers such as `--size`) are reported by clap during `Opts::parse()` and use clap's own exit status (2).

`ExitCode::exit()` calls `process::exit`. For `KilledBySigint` on Unix it first restores the default SIGINT handler and re-raises SIGINT, so the parent shell sees a genuine signal death rather than just status 130 (important for scripts and shells that stop loops on Ctrl-C).

### Merging

`merge_exitcodes` combines results from several sources (multiple `--exec` threads, multiple commands, multiple batch builders): if **any** code is an error (non-zero status), the result is `GeneralError`; otherwise `Success`. Note that this maps `KilledBySigint` to `GeneralError` as well. The unit tests in `exit_codes.rs` pin these rules.

## `--quiet`

`-q`/`--quiet` (alias `--has-results`) turns fd into a predicate. The receiver returns `HasResults(true)` as soon as the first entry arrives, which sets the quit flag and stops the walk early; if the walk finishes with no entries, it returns `HasResults(false)`. It conflicts with `--max-results` and with the exec family. See [Parallel Walk and Receiver](../architecture/parallel-walk-and-receiver.md#early-termination).

## Error reporting

All diagnostic messages go through `error::print_error`, which prints `[fd error]: <msg>` to stderr. When stderr is a terminal, the message is passed through `sanitize::maybe_sanitize` so file names containing control characters can't inject terminal escapes (see [Output Formatting](../features/output-formatting.md)).

Kinds of errors:

- **Fatal setup errors** – any `Err` returned by `run()` in `src/main.rs` (e.g. invalid `--base-directory`, no valid search paths, pattern containing a path separator, invalid regex or time value, dot-only pattern without `--hidden`, malformed `--exclude`, `--list-details` unsupported) is printed with its full `anyhow` context chain (`{err:#}`) and exits with status 1.
- **Non-fatal setup warnings** – a search path that is not a directory is reported and skipped; malformed patterns in the global ignore file or a `--ignore-file` are reported and the search continues.
- **Filesystem errors during traversal** (permission denied, I/O errors, symlink loops, …) arrive as `WorkerResult::Error` and are **silent by default**; `--show-errors` prints them. They do not change the exit code. Broken symlinks are not errors: they are reported as entries.
- **Command errors** – see [Command Execution](../features/command-execution.md#errors-and-exit-codes).

## Output errors and broken pipes

Rust ignores `SIGPIPE`, so writing to a closed pipe (e.g. `fd | head`) produces `BrokenPipe` I/O errors instead of killing the process. In `ReceiverBuffer::print`, a `BrokenPipe` write error is ignored, while any other write error prints "Could not write to output" and ends with `GeneralError`. The subsequent `flush` will fail on a broken pipe, and the receiver then stops quietly with `GeneralError` (status 1) — no error message is printed. When the receiver stops, it sets the quit flag so the walker threads terminate promptly.

## Ctrl-C / SIGINT

The `ctrlc` handler is installed in `WorkerState::scan` **only when colored output is being printed** — the case where an interrupted ANSI sequence could leave the terminal in a colored state. In other cases the default SIGINT behavior terminates fd immediately.

With the handler installed:

1. The first Ctrl-C sets `quit_flag` (walkers return `WalkState::Quit`) and `interrupt_flag`.
2. After printing the current entry, the receiver sees `interrupt_flag`, flushes stdout (finishing the current styled line) and returns `KilledBySigint`.
3. `scan` checks `interrupt_flag` once all threads are joined and returns `KilledBySigint`, so `main` exits via `ExitCode::exit()` (re-raising SIGINT on Unix).
4. A second Ctrl-C while shutting down exits immediately with `KilledBySigint`.

## Tests

- Unit tests in `src/exit_codes.rs` cover `merge_exitcodes`.
- `tests/tests.rs` checks exit codes via the `TestEnv` helpers (e.g. quiet mode, invalid arguments, failing `--exec` commands). See [Testing](../testing/integration-tests.md).
