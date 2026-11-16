---
type: operations
title: Exit Codes and Error Handling
description: ExitCode semantics in fd (success, quiet-mode results, general error, SIGINT re-raise), how errors are printed with the [fd error] prefix, which filesystem errors are shown, and how exec job results are merged.
tags: [exit-codes, errors, sigint, quiet, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# Exit Codes and Error Handling

## `ExitCode` (`src/exit_codes.rs`)

The enum has four variants mapped to process exit statuses:

| Variant | Status | Produced when |
| --- | --- | --- |
| `Success` | 0 | normal completion (even with zero results) |
| `HasResults(bool)` | `0` if true, `1` if false | `--quiet` runs only |
| `GeneralError` | 1 | startup errors, write failures, failed commands |
| `KilledBySigint` | 130 | user interrupt |

Important consequences:

- A normal search that finds nothing still exits **0**; only `--quiet` makes "no results" an exit status of 1 (grep-style). `--quiet` is incompatible with `--exec`/`--exec-batch`/`--list-details` (clap-level conflict).
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `merge_exitcodes` folds many codes into one: *any* non-zero input (including `KilledBySigint`) yields `GeneralError`, otherwise `Success`. It is used for per-thread `exec::job` results and for the per-command results of a batch execution ([command execution](/openwiki/workflows/command-execution.md)). Exit-status details of individual child processes are therefore not propagated, only success/failure.
- `ExitCode::exit()` on Unix handles `KilledBySigint` specially: it restores the default SIGINT handler and re-raises SIGINT against itself so a parent shell sees termination *by signal*, only falling back to `process::exit(130)` if that fails.

## Where errors originate and how they surface

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`main()` calls `run()` and either exits with the returned `ExitCode`, or, on `Err`, prints `format!("{err:#}")` (the anyhow chain) through `print_error` and exits `GeneralError`. Typical early failures (all produced before any walking starts; see [CLI and configuration](/openwiki/architecture/cli-and-configuration.md)):

- invalid `--base-directory`, no valid search paths, or an unavailable cwd for `--full-path`,
<!-- openwiki: broken internal link [/openwiki/concepts/pattern-matching.md] link "/openwiki/concepts/pattern-matching.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- path-like search patterns and leading-dot-with-hidden-filtered patterns ([pattern matching](/openwiki/concepts/pattern-matching.md)),
- bad regex/glob, bad size/time/owner values, malformed `--exclude` patterns, and a multi-byte Windows path separator,
- `--exec-batch` template errors (placeholder as executable, more than one placeholder, no command).

Note that invalid *individual* search paths are only warned about (`Search path '…' is not a directory.`) and skipped.

<!-- openwiki: broken internal link [/openwiki/concepts/output-and-terminal-safety.md] link "/openwiki/concepts/output-and-terminal-safety.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`print_error` (`src/error.rs`) writes `[fd error]: <message>` to stderr, sanitizing control characters when stderr is a terminal ([output safety](/openwiki/concepts/output-and-terminal-safety.md)).

### Runtime (walk-time) errors

- Walker errors such as permission-denied are wrapped as `WorkerResult::Error`, flow through the same channel as entries, and are printed **only** with `--show-errors`; otherwise they are silently dropped by the receiver, `exec::job` and `exec::batch` alike. They do not change the exit code.
- Dangling symlinks are *not* errors: they are re-classified as `DirEntry::broken_symlink`.
- Ignore-file problems: partial parse errors are tolerated; other malformed-pattern errors print a message but don't abort.
- Output problems: `BrokenPipe` writes are ignored; other write errors print `Could not write to output` and return `GeneralError`; a failing flush returns `GeneralError` silently.
- Command problems (`--exec`): `Command not found: <program>` for a missing executable, otherwise `Problem while executing command: <err>`; both yield `GeneralError`. A command exiting non-zero also yields `GeneralError`, and in one-by-one mode flushes any buffered output of that job first.

## Interrupt handling

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-walk-and-receiver.md] link "/openwiki/architecture/parallel-walk-and-receiver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
When printing with colors, a Ctrl-C handler is installed ([walk details](/openwiki/architecture/parallel-walk-and-receiver.md)). The first press sets `quit_flag` and `interrupt_flag`: the receiver finishes the current print, flushes, and returns `KilledBySigint`; `scan` then returns `KilledBySigint` regardless of the receiver's own code. A second press exits immediately. Without that handler (no colors, or command mode) the default SIGINT behavior terminates the process directly.

## Testing

<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`exit_codes.rs` has unit tests for `merge_exitcodes`. Integration tests such as `test_quiet`, `test_invalid_cwd`, `test_number_parsing_errors`, `test_exec`, and the `assert_failure*` helpers in `tests/testenv` check statuses and messages ([harness](/openwiki/testing/integration-test-harness.md)).
