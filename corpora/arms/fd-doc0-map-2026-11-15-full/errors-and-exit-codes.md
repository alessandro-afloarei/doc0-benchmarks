---
title: "Errors and Exit Codes"
---
## Overview

fd reports problems in two ways: a message on stderr through `print_error`, and the process exit status through the `ExitCode` enum. Code inside fd returns `anyhow::Result` up to `main`, or an `ExitCode` from the walker and the command runners, and only `ExitCode::exit` ends the process. Scripts can therefore rely on the status: `0` for success, `1` for an error or for no match with `--quiet`, `130` after Ctrl-C.

Sources: [src/main.rs:62-73](repo://src/main.rs#L62-L73), [src/exit_codes.rs:6-44](repo://src/exit_codes.rs#L6-L44)

## Exit codes

### Status values

| Variant | Status | Produced when |
| --- | --- | --- |
| `Success` | 0 | The search, and every command, finished |
| `HasResults(true)` | 0 | `--quiet` and at least one match |
| `HasResults(false)` | 1 | `--quiet` and no match |
| `GeneralError` | 1 | `run` returned an error, output failed, or a command failed or was not found |
| `KilledBySigint` | 130 | Ctrl-C was pressed during a colored, printing search |

Sources: [src/exit_codes.rs:6-23](repo://src/exit_codes.rs#L6-L23), [src/walk.rs:282-293](repo://src/walk.rs#L282-L293), [src/walk.rs:648-652](repo://src/walk.rs#L648-L652)

### Exiting after Ctrl-C

On Unix, `exit` for `KilledBySigint` first restores the default `SIGINT` handler and raises `SIGINT` against itself, so the parent shell sees fd killed by the signal rather than a plain exit. A shell loop running fd stops on Ctrl-C as it would for any other program. If raising fails, it falls back to exit status 130.

Sources: [src/exit_codes.rs:30-43](repo://src/exit_codes.rs#L30-L43)

### Merging codes

`merge_exitcodes` folds many codes into one: `GeneralError` if any of them is non-zero, else `Success`. The `--exec` job threads, the commands run for a single result, and the batch builders all merge their codes this way, so one failing command makes fd exit with 1 while the other commands still run. A `KilledBySigint` inside a merge also counts as an error.

Sources: [src/exit_codes.rs:46-51](repo://src/exit_codes.rs#L46-L51), [src/exit_codes.rs:62-84](repo://src/exit_codes.rs#L62-L84), [src/walk.rs:430-431](repo://src/walk.rs#L430-L431), [src/exec/job.rs:40](repo://src/exec/job.rs#L40)

## Error messages

### Message format

`print_error` writes `[fd error]: <message>` to stderr. When stderr is a terminal, the message is passed through `maybe_sanitize` first, because messages often quote file names and a crafted name could otherwise carry terminal escape sequences ([[Output and Colors]]).

Sources: [src/error.rs:1-9](repo://src/error.rs#L1-L9), [src/sanitize.rs:48-55](repo://src/sanitize.rs#L48-L55)

### Fatal errors

Errors that stop fd before or at the start of the search are `anyhow` errors returned from `run`. `main` prints them with the alternate `{err:#}` format, which joins the context chain, and exits with `GeneralError`.

Sources: [src/main.rs:62-73](repo://src/main.rs#L62-L73)

| Message starts with | Cause |
| --- | --- |
| `The '--base-directory' path` | `-C` names something that is not a directory |
| `No valid search paths given.` | No search path is an existing directory |
| `The search pattern '…' contains a path-separation character` | The pattern holds `/` without `--full-path` |
| `The pattern(s) seems to only match files with a leading dot` | A `^\.` pattern while hidden files are skipped |
| `A path separator must be exactly one byte` | A multi-byte `--path-separator` on Windows |
| `'…' is not a valid date or duration` | Bad `--changed-within` or `--changed-before` value |
| `Malformed exclude pattern` | An invalid `--exclude` glob |
| regex error, then a note on `--fixed-strings` | The pattern does not compile |

Sources: [src/main.rs:131-216](repo://src/main.rs#L131-L216), [src/main.rs:234-246](repo://src/main.rs#L234-L246), [src/main.rs:496-555](repo://src/main.rs#L496-L555), [src/walk.rs:330-345](repo://src/walk.rs#L330-L345)

Values that clap parses, such as `--size`, `--owner` and the `--exec` template, fail during argument parsing instead, with clap's usage error.

Sources: [src/filter/size.rs:28-31](repo://src/filter/size.rs#L28-L31), [src/filter/owner.rs:24-58](repo://src/filter/owner.rs#L24-L58), [src/cli.rs:861-874](repo://src/cli.rs#L861-L874)

### Non-fatal errors

Some problems are reported and the search continues. A search path that is not a directory is printed and skipped. A malformed global or custom ignore file is printed and the rest of it is used. Walk errors such as permission denied are sent to the receiver and printed only with `--show-errors`.

Sources: [src/cli.rs:707-720](repo://src/cli.rs#L707-L720), [src/walk.rs:371-396](repo://src/walk.rs#L371-L396), [src/walk.rs:227-231](repo://src/walk.rs#L227-L231)

A broken pipe while writing results, for example `fd | head`, is not reported: the write error is ignored and the next failed flush ends the run quietly.

Sources: [src/walk.rs:251-258](repo://src/walk.rs#L251-L258), [src/walk.rs:295-302](repo://src/walk.rs#L295-L302)
