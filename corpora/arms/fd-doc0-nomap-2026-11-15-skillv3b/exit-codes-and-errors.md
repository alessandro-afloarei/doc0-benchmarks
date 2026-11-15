---
title: "Exit Codes and Errors"
---
## Overview

fd reports its outcome in two ways: a process exit code that scripts can test, and messages on stderr prefixed with `[fd error]:`. Both are deliberately simple. `ExitCode` in `src/exit_codes.rs` has four variants, and every error message, whether fatal or not, goes through the one `print_error` function in `src/error.rs`. This page lists what each code means, which problems stop fd and which only produce a warning, and how an interrupted search exits.

Sources: [src/exit_codes.rs:6-23](repo://src/exit_codes.rs#L6-L23), [src/error.rs:1-9](repo://src/error.rs#L1-L9)

## Exit codes

### Code table

| Variant | Code | When |
| --- | --- | --- |
| `Success` | 0 | The search finished, whether or not anything matched, and every command succeeded |
| `HasResults(true)` | 0 | `--quiet`: at least one match was found |
| `HasResults(false)` | 1 | `--quiet`: no match was found |
| `GeneralError` | 1 | A fatal error, an output write failure, or a failed `--exec`/`--exec-batch` command |
| `KilledBySigint` | 130 | The search was interrupted with Ctrl-C |

Sources: [src/exit_codes.rs:14-23](repo://src/exit_codes.rs#L14-L23)

Without `--quiet`, finding nothing is not an error: fd exits 0 with empty output. Use `-q` (alias `--has-results`) when a script needs to branch on whether anything matched; it also stops at the first match ([[Parallel Search Pipeline]]).

Sources: [src/cli.rs:588-601](repo://src/cli.rs#L588-L601), [src/walk.rs:281-293](repo://src/walk.rs#L281-L293)

### Merging codes from several workers

When several units of work each produce a code (the `--exec` job threads, or the commands of an `--exec-batch` set), `merge_exitcodes` combines them. Any code that converts to a non-zero number makes the result `GeneralError`; otherwise it is `Success`. An empty set counts as success.

Sources: [src/exit_codes.rs:25-28](repo://src/exit_codes.rs#L25-L28), [src/exit_codes.rs:46-51](repo://src/exit_codes.rs#L46-L51), [src/walk.rs:430-431](repo://src/walk.rs#L430-L431)

## How the process ends

### Normal exit

`main` calls `run`. An `Ok(code)` is passed to `ExitCode::exit`; an `Err` is printed with `print_error(format!("{err:#}"))`, where the alternate format includes the `anyhow` context chain, and the process exits with `GeneralError`.

Sources: [src/main.rs:62-73](repo://src/main.rs#L62-L73)

### Exiting after Ctrl-C

For `KilledBySigint`, `ExitCode::exit` on Unix first restores the default `SIGINT` handler and raises `SIGINT` against itself. The process then dies from the signal, which is what shells and parent processes expect from an interrupted program (for example, a shell loop around `fd` stops too). If raising the signal does not end the process, it falls back to `process::exit(130)`. [[Parallel Search Pipeline]] explains when the first and second Ctrl-C take effect.

Sources: [src/exit_codes.rs:30-44](repo://src/exit_codes.rs#L30-L44), [src/walk.rs:625-633](repo://src/walk.rs#L625-L633)

## Error messages

### print_error

`print_error` writes `[fd error]: message` to stderr. Before writing, it passes the message through `maybe_sanitize`, checking whether stderr is a terminal, so a file name inside an error cannot inject terminal escape sequences. The sanitising rules are on [[Output Formatting]].

Sources: [src/error.rs:1-9](repo://src/error.rs#L1-L9), [src/sanitize.rs:48-55](repo://src/sanitize.rs#L48-L55)

### Fatal errors

These errors are returned from `run` and end fd with exit code 1 before or at the start of the search:

Sources: [src/main.rs:81-85](repo://src/main.rs#L81-L85), [src/main.rs:131-148](repo://src/main.rs#L131-L148), [src/main.rs:198-215](repo://src/main.rs#L198-L215), [src/main.rs:234-246](repo://src/main.rs#L234-L246), [src/main.rs:476-493](repo://src/main.rs#L476-L493), [src/main.rs:496-555](repo://src/main.rs#L496-L555), [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/cli.rs:963-971](repo://src/cli.rs#L963-L971)

| Message starts with | Cause | Where |
| --- | --- | --- |
| `No valid search paths given.` | None of the given roots is an existing directory | `run` |
| `Could not retrieve current directory` | No root given and the current directory has been deleted | `ensure_current_directory_exists` |
| `The '--base-directory' path ... is not a directory.` | Bad `-C` value | `set_working_dir` |
| `The search pattern ... contains a path-separation character` | Pattern with `/` and no `--full-path` | `ensure_single_search_pattern_is_not_a_path` |
| `The pattern(s) seems to only match files with a leading dot` | Pattern starting with `^\.` while hidden files are skipped (Unix) | `ensure_use_hidden_option_for_leading_dot_pattern` |
| regex error text plus a note on `--fixed-strings`, `--exact`, `--glob` | Pattern is not a valid regex | `build_regex` |
| `... is not a valid date or duration.` | Bad `--changed-within`/`--changed-before` | `extract_time_constraints` |
| `A path separator must be exactly one byte` | Long `--path-separator` on Windows | `check_path_separator_length` |
| `'fd --list-details' is not supported ...` | No usable `ls` on this platform | `determine_ls_command` |
| `Malformed exclude pattern` | Bad `--exclude` glob | `build_overrides` |

Sources: [src/main.rs:81-85](repo://src/main.rs#L81-L85), [src/main.rs:131-148](repo://src/main.rs#L131-L148), [src/main.rs:198-215](repo://src/main.rs#L198-L215), [src/main.rs:234-246](repo://src/main.rs#L234-L246), [src/main.rs:476-493](repo://src/main.rs#L476-L493), [src/main.rs:496-555](repo://src/main.rs#L496-L555), [src/walk.rs:330-345](repo://src/walk.rs#L330-L345), [src/cli.rs:963-971](repo://src/cli.rs#L963-L971)

Errors in option values with their own parsers, such as `--size`, `--owner`, `--threads` or an invalid `--exec` template, are reported by clap while parsing arguments, together with a usage hint, before `run` does anything else ([[Command-Line Interface]]).

Sources: [src/cli.rs:412-417](repo://src/cli.rs#L412-L417), [src/cli.rs:861-874](repo://src/cli.rs#L861-L874), [src/filter/size.rs:28-31](repo://src/filter/size.rs#L28-L31)

### Warnings that do not stop the search

Some problems are reported and then skipped so the rest of the search can go ahead:

Sources: [src/cli.rs:707-720](repo://src/cli.rs#L707-L720), [src/walk.rs:371-396](repo://src/walk.rs#L371-L396), [src/exec/command.rs:101-115](repo://src/exec/command.rs#L101-L115), [src/walk.rs:251-258](repo://src/walk.rs#L251-L258)

- A search path that is not a directory: `Search path '...' is not a directory.`, and that root is dropped.
- A malformed line in the global ignore file or an `--ignore-file`: the file is not used ([[Ignore Rules and Traversal]]).
- A command that cannot be started is reported; one that exits non-zero is not, but either makes the final exit code 1 ([[Command Execution]]).
- A write failure on stdout other than a broken pipe: `Could not write to output: ...`, which ends the search with exit code 1.

Sources: [src/cli.rs:707-720](repo://src/cli.rs#L707-L720), [src/walk.rs:371-396](repo://src/walk.rs#L371-L396), [src/exec/command.rs:101-115](repo://src/exec/command.rs#L101-L115), [src/walk.rs:251-258](repo://src/walk.rs#L251-L258)

## Filesystem errors

Errors met while walking, such as a directory without read permission or a symlink loop, arrive as `WorkerResult::Error`. They are silent by default, because a search across a whole disk would otherwise be buried in permission errors, and they do not change the exit code. With `--show-errors`, the receiver, a job thread or the batch runner prints each one with `print_error`.

Sources: [src/walk.rs:227-231](repo://src/walk.rs#L227-L231), [src/exec/job.rs:23-31](repo://src/exec/job.rs#L23-L31), [src/exec/job.rs:51-61](repo://src/exec/job.rs#L51-L61), [src/cli.rs:603-611](repo://src/cli.rs#L603-L611)

A missing target behind a followed symlink is not treated as an error: it is turned into a broken-symlink entry and can appear in results ([[Parallel Search Pipeline]]).

Sources: [src/walk.rs:485-499](repo://src/walk.rs#L485-L499)
