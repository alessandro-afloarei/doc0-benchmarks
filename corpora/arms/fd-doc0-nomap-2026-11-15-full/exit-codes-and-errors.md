---
title: "Exit Codes and Errors"
---
## Overview

fd reports its outcome through a small `ExitCode` enum rather than raw integers, so that the walker, the printing loop and the command jobs can all return a code and have them merged in one place. Errors that stop the program travel as `anyhow` errors out of `run` and are printed once by `main`; problems that do not stop the search (a missing search path, a malformed ignore file, a failed command) are printed where they happen and the search goes on.

Sources: [src/exit_codes.rs:1-48](repo://src/exit_codes.rs#L1-L48), [src/main.rs:62-73](repo://src/main.rs#L62-L73)

## Exit codes

| Variant | Code | Produced when |
| --- | --- | --- |
| `Success` | 0 | The search finished; also with `--max-results` once the limit is hit |
| `HasResults(true)` | 0 | `--quiet` and at least one match |
| `HasResults(false)` | 1 | `--quiet` and no match |
| `GeneralError` | 1 | An error from `run`, an output write failure, or a failed or missing command |
| `KilledBySigint` | 130 | Ctrl-C during a colored, printing search |

Sources: [src/exit_codes.rs:6-22](repo://src/exit_codes.rs#L6-L22), [src/walk.rs:198-206](repo://src/walk.rs#L198-L206), [src/walk.rs:281-293](repo://src/walk.rs#L281-L293)

> [!NOTE]
> A search that finds nothing exits with 0 unless `--quiet` (alias `--has-results`) is given.

Sources: [src/walk.rs:281-293](repo://src/walk.rs#L281-L293), [src/cli.rs:588-601](repo://src/cli.rs#L588-L601)

## Merging codes

`merge_exitcodes` folds several codes into one: any code that is not 0 turns the result into `GeneralError`, else it is `Success`. It merges the codes of the parallel `--exec` job threads, the commands of one job, and the builders of a batch command, so one failing command makes the whole run exit with 1 while the other commands still run.

Sources: [src/exit_codes.rs:45-50](repo://src/exit_codes.rs#L45-L50), [src/walk.rs:416-432](repo://src/walk.rs#L416-L432), [src/exec/job.rs:33-43](repo://src/exec/job.rs#L33-L43)

## Exiting and SIGINT

`ExitCode::exit` calls `process::exit` with the numeric code. For `KilledBySigint` on Unix it first resets the SIGINT handler to the default and raises SIGINT, so the parent shell sees fd killed by the signal rather than a plain exit status of 130.

Sources: [src/exit_codes.rs:24-43](repo://src/exit_codes.rs#L24-L43)

[[Parallel Directory Walk]] shows where the Ctrl-C handler sets the interrupt flag that produces this code.

Sources: [src/walk.rs:621-653](repo://src/walk.rs#L621-L653)

## Printing errors

### The error printer

`print_error` writes a message to stderr with the `[fd error]: ` prefix, sanitized when stderr is a terminal so that a path inside the message cannot inject escape sequences. `main` prints the error from `run` with `{err:#}`, which includes the whole `anyhow` context chain on one line, then exits with `GeneralError`.

Sources: [src/error.rs:1-9](repo://src/error.rs#L1-L9), [src/main.rs:62-73](repo://src/main.rs#L62-L73)

### Fatal errors

These abort before or during the scan, through `run`.

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112)

- `--base-directory` is not a directory, or cannot be entered.
- No valid search path remains, or the current directory was deleted.
- A pattern holds a path separator without `--full-path`.
- A pattern only matches hidden files (`^\.`) while hidden files are skipped.
- A regex does not compile; the message suggests `--fixed-strings`, `--exact` or `--glob`.
- A date or duration for `--changed-within`/`--changed-before` cannot be parsed.
- An `--exclude` glob is malformed.
- `--list-details` has no usable `ls` on this platform.

Sources: [src/main.rs:131-147](repo://src/main.rs#L131-L147), [src/main.rs:169-216](repo://src/main.rs#L169-L216), [src/main.rs:496-555](repo://src/main.rs#L496-L555), [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/cli.rs:963-971](repo://src/cli.rs#L963-L971)

### Errors that do not stop the search

- A search path that is not a directory is reported and skipped.
- A malformed pattern in the global or a custom ignore file is reported; partial errors are ignored.
- Filesystem errors during the walk (permissions, dead links) are reported only with `--show-errors`.
- A command that cannot be found prints "Command not found", other spawn failures print "Problem while executing command"; both make the final code 1.

Sources: [src/cli.rs:707-720](repo://src/cli.rs#L707-L720), [src/walk.rs:371-396](repo://src/walk.rs#L371-L396), [src/walk.rs:227-231](repo://src/walk.rs#L227-L231), [src/exec/command.rs:101-115](repo://src/exec/command.rs#L101-L115)
