---
title: "Errors and Exit Codes"
---
## Overview

fd reports problems in two ways: messages on stderr, all written by `print_error` with an `[fd error]:` prefix, and the process exit status, chosen from the small `ExitCode` enum. Every flow returns an `ExitCode` (the printer, the command jobs, the batch runner), and `main` turns it, or any startup error, into the status the shell sees. This page lists the codes, how several codes are combined, and how Ctrl-C ends a run; the pages of each flow explain when their codes arise.

Sources: [src/exit_codes.rs:1-51](repo://src/exit_codes.rs#L1-L51), [src/error.rs:1-9](repo://src/error.rs#L1-L9)

## Exit codes

| `ExitCode` | Status | Returned when |
| --- | --- | --- |
| `Success` | 0 | the search finished, with or without results |
| `HasResults(true)` | 0 | `--quiet` and at least one match |
| `HasResults(false)` | 1 | `--quiet` and no match |
| `GeneralError` | 1 | an error at startup, an output error, or a failed command |
| `KilledBySigint` | 130, or death by `SIGINT` on Unix | Ctrl-C during the search |

Sources: [src/exit_codes.rs:6-23](repo://src/exit_codes.rs#L6-L23)

Without `--quiet`, a search that finds nothing still exits with 0, unlike `grep`. Scripts that need to test for matches should use `-q` (alias `--has-results`), which also stops the walk at the first match. [[Printing Results]] shows where the receiver returns these codes.

Sources: [src/walk.rs:203-206](repo://src/walk.rs#L203-L206), [src/walk.rs:281-293](repo://src/walk.rs#L281-L293), [src/cli.rs:588-601](repo://src/cli.rs#L588-L601)

## Startup errors

`main` calls `run`, which returns `Result<ExitCode>`. Any `Err`, from a bad base directory, an invalid regex, an unknown time format or a malformed `--exclude` glob, is printed with `print_error` using the `{err:#}` format, which includes the chain of `anyhow` contexts, and the process exits with `GeneralError`. Usage errors that clap detects while parsing (unknown flags, conflicting options, bad values from `SizeFilter::from_string` or `OwnerFilter::from_string`) are reported by clap itself before `run` gets that far.

Sources: [src/main.rs:62-73](repo://src/main.rs#L62-L73), [src/main.rs:75-112](repo://src/main.rs#L75-L112)

Several startup checks exist only to replace "no results" with an explanation: a pattern containing `/` without `--full-path`, and a pattern like `^\.` while hidden files are skipped. [[Pattern Matching]] describes both.

Sources: [src/main.rs:149-216](repo://src/main.rs#L149-L216), [src/main.rs:521-539](repo://src/main.rs#L521-L539)

## Merging codes

`merge_exitcodes` combines the codes of several command runs into one: if any of them is an error (a non-zero status, including `KilledBySigint`), the result is `GeneralError`; otherwise `Success`. An empty list is `Success`. The job threads of `--exec`, each job's own sequence of commands, and the builders of `--exec-batch` all use it, so one failing command makes the whole run exit with 1 while the other results are still processed; see [[Command Execution]].

Sources: [src/exit_codes.rs:25-28](repo://src/exit_codes.rs#L25-L28), [src/exit_codes.rs:46-51](repo://src/exit_codes.rs#L46-L51), [src/walk.rs:430-431](repo://src/walk.rs#L430-L431), [src/exec/job.rs:26](repo://src/exec/job.rs#L26-L26)

## Ctrl-C

When results are printed in colour, `scan` installs a handler with the `ctrlc` crate. The first Ctrl-C sets `quit_flag`, so walker threads stop, and `interrupt_flag`, which the receiver checks after every printed entry: it flushes what it has and returns `KilledBySigint`, so the terminal is never left in the middle of an escape sequence. A second Ctrl-C exits at once. Without colours, no handler is installed and the default `SIGINT` behaviour kills fd immediately.

Sources: [src/walk.rs:621-634](repo://src/walk.rs#L621-L634), [src/walk.rs:260-264](repo://src/walk.rs#L260-L264), [src/walk.rs:648-652](repo://src/walk.rs#L648-L652)

`ExitCode::exit` treats `KilledBySigint` specially on Unix: it restores the default `SIGINT` handler and raises `SIGINT` against itself, so the parent shell sees that fd was killed by the signal, as a shell loop expects, rather than a plain exit. Only if raising fails does the process exit with 130.

Sources: [src/exit_codes.rs:30-44](repo://src/exit_codes.rs#L30-L44)

## Error messages

`print_error` writes `[fd error]: <message>` to stderr. When stderr is a terminal, the message goes through `maybe_sanitize` first, because messages often quote file names, and a name containing escape sequences could otherwise inject them into the terminal ([[Printing Results]] lists the escaped characters).

Sources: [src/error.rs:1-9](repo://src/error.rs#L1-L9)

| Source | When it is printed | Effect on exit code |
| --- | --- | --- |
| Filesystem errors from the walker (permission denied, broken links) | only with `--show-errors` | none |
| A search path that is not a directory | always | none, unless no path is left |
| A malformed line in the global or a custom ignore file | always | none |
| A write error on stdout (not a broken pipe) | always | `GeneralError` |
| A command that cannot be started | always | `GeneralError` |

Sources: [src/walk.rs:227-231](repo://src/walk.rs#L227-L231), [src/walk.rs:251-258](repo://src/walk.rs#L251-L258), [src/walk.rs:371-396](repo://src/walk.rs#L371-L396), [src/cli.rs:707-720](repo://src/cli.rs#L707-L720), [src/exec/command.rs:101-115](repo://src/exec/command.rs#L101-L115)

A closed pipe, as in `fd | head -1`, is not reported: writing ignores `BrokenPipe`, and the flush that fails afterwards ends the receiver quietly with `GeneralError`.

Sources: [src/walk.rs:251-258](repo://src/walk.rs#L251-L258), [src/walk.rs:295-302](repo://src/walk.rs#L295-L302)
