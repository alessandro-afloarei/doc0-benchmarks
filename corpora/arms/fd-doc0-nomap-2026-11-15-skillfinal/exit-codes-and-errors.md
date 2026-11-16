---
title: "Exit Codes and Error Reporting"
---
## Overview

fd reports problems in two ways. A fatal problem (an invalid regex, a bad option value, no valid search path) is an `anyhow::Error` returned from `run`; `main` prints it and exits with status 1. A problem with one entry, ignore file, search path or command is printed where it happens and the search goes on. Either way the process ends through `ExitCode::exit`, which maps fd's `ExitCode` enum onto a numeric status.

Sources: [src/main.rs:62-73](repo://src/main.rs#L62-L73), [src/exit_codes.rs:1-43](repo://src/exit_codes.rs#L1-L43)

When the receiver chooses each code is described on [[Result Buffering and Ordering]] and [[Command Execution]]; this page covers the codes themselves and how messages are printed.

Sources: [src/walk.rs:281-293](repo://src/walk.rs#L281-L293), [src/exec/job.rs:34-43](repo://src/exec/job.rs#L34-L43)

## ExitCode

| Variant | Status | Produced by |
| --- | --- | --- |
| `Success` | 0 | a normal search, including one that found nothing |
| `HasResults(true)` | 0 | `--quiet` when something matched |
| `HasResults(false)` | 1 | `--quiet` when nothing matched |
| `GeneralError` | 1 | a fatal error, an output error, a failed command |
| `KilledBySigint` | 130 | Ctrl-C |

Sources: [src/exit_codes.rs:6-23](repo://src/exit_codes.rs#L6-L23)

Status 1 is therefore both "error" and "no match with `--quiet`", which is why `--quiet` (alias `--has-results`) is documented as "exit code 0 if match found, 1 otherwise". Without `--quiet`, finding nothing is not an error.

Sources: [src/cli.rs:588-601](repo://src/cli.rs#L588-L601), [src/walk.rs:288-292](repo://src/walk.rs#L288-L292)

## Merging codes

Several parts of fd produce more than one code: the `--exec` job threads, the commands of one entry, the builders of `--exec-batch`. `merge_exitcodes` reduces them: if any code maps to a non-zero status it returns `GeneralError`, otherwise `Success`. An empty list is `Success`, and a `KilledBySigint` from a job also becomes `GeneralError`.

Sources: [src/exit_codes.rs:25-28](repo://src/exit_codes.rs#L25-L28), [src/exit_codes.rs:46-94](repo://src/exit_codes.rs#L46-L94)

## Exiting on SIGINT

`ExitCode::exit` calls `process::exit` with the mapped status. For `KilledBySigint` on Unix it first restores the default SIGINT handler and raises SIGINT, so the parent shell sees a process killed by the signal rather than one that exited normally. Only if raising the signal does not end the process does it fall through to `exit(130)`.

Sources: [src/exit_codes.rs:30-43](repo://src/exit_codes.rs#L30-L43)

fd installs its own Ctrl-C handler only when it prints colored results; otherwise the default SIGINT behaviour stops it. With the handler, the first Ctrl-C asks the walker and receiver to stop, and the receiver flushes and returns `KilledBySigint`. A second Ctrl-C calls `ExitCode::KilledBySigint.exit()` from the handler at once. `WorkerState::scan` returns `KilledBySigint` whenever the interrupt flag was set, whatever the receiver returned.

Sources: [src/walk.rs:621-653](repo://src/walk.rs#L621-L653), [src/walk.rs:260-264](repo://src/walk.rs#L260-L264)

## Printing errors

### print_error

Every fd message goes through `print_error`, which writes `[fd error]: <message>` to stderr. When stderr is a terminal, the message is first passed through `maybe_sanitize`, so a file name quoted in an error cannot carry escape sequences (see [[Output Formatting]]).

Sources: [src/error.rs:1-9](repo://src/error.rs#L1-L9)

```rust
pub fn print_error(msg: impl Into<String>) {
    let msg = msg.into();
    let safe = maybe_sanitize(&msg, std::io::stderr().is_terminal());
    eprintln!("[fd error]: {safe}");
}
```

Sources: [src/error.rs:5-9](repo://src/error.rs#L5-L9)

### Fatal errors

`main` formats a fatal error with `{err:#}`, anyhow's alternate format, which appends each context to the message on one line. Fatal errors include an invalid `--base-directory`, a pattern containing a path separator, a leading-dot pattern without `--hidden`, a regex that does not compile, an invalid time value, a malformed `--exclude` glob, and an `--list-details` that the platform cannot support. clap reports invalid arguments itself, including the errors raised while parsing `--exec` commands, `--size` and `--owner`.

Sources: [src/main.rs:62-73](repo://src/main.rs#L62-L73), [src/main.rs:131-147](repo://src/main.rs#L131-L147), [src/main.rs:496-519](repo://src/main.rs#L496-L519), [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/cli.rs:861-874](repo://src/cli.rs#L861-L874)

### Non-fatal errors

| Situation | Message | Effect |
| --- | --- | --- |
| A search path is not a directory | `Search path '...' is not a directory.` | path dropped |
| Bad line in the global or a custom ignore file | `Malformed pattern in ... ignore file.` | file still used |
| Filesystem error during the walk | the `ignore` error text | shown only with `--show-errors` |
| Writing to stdout fails (not a broken pipe) | `Could not write to output: ...` | search ends with status 1 |
| A command cannot be started | `Command not found: ...` or `Problem while executing command: ...` | status 1 |

Sources: [src/cli.rs:707-720](repo://src/cli.rs#L707-L720), [src/walk.rs:371-396](repo://src/walk.rs#L371-L396), [src/walk.rs:227-231](repo://src/walk.rs#L227-L231), [src/walk.rs:251-258](repo://src/walk.rs#L251-L258), [src/exec/command.rs:101-115](repo://src/exec/command.rs#L101-L115)

A command that runs and exits with a non-zero status prints nothing from fd itself; it only turns the final status into 1.

Sources: [src/exec/command.rs:81-89](repo://src/exec/command.rs#L81-L89), [src/exec/mod.rs:191-196](repo://src/exec/mod.rs#L191-L196)
