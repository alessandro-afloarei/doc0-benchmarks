---
type: concept
title: Exit Codes and Error Reporting
description: What exit status fd reports for success, no matches under --quiet, command failures, usage errors, and Ctrl-C, how those codes are merged across --exec jobs, and how errors and filesystem warnings are written to stderr, including the terminal sanitization applied to messages.
tags: [exit-codes, errors, stderr, quiet, sigint, sanitization]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Exit Codes and Error Reporting

`fd` uses a small internal `ExitCode` enum in `src/exit_codes.rs` and reports errors
through `print_error` in `src/error.rs`. This page lists what each code means in practice,
where it is produced, and why the default behavior differs from `--quiet`. The traversal
side that produces many of these values is described in
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Parallel Traversal](/openwiki/architecture/parallel-traversal.md).

## Exit code values

| Variant | Process status | Produced when |
| --- | --- | --- |
| `Success` | 0 | Normal completion, including when nothing matched. |
| `HasResults(true)` | 0 | `--quiet` and at least one entry matched. |
| `HasResults(false)` | 1 | `--quiet` and no entry matched. |
| `GeneralError` | 1 | Usage or I/O errors, a failed `--exec` command, or a failed stdout write or flush. |
| `KilledBySigint` | 130 | Ctrl-C was pressed during printing. |

The conversion lives in `impl From<ExitCode> for i32`. Note that `HasResults(bool)` maps
to `!has_results`, so a match is success (0) and no match is failure (1).

### Default mode versus `--quiet`

Without `--quiet`, the receiver's shutdown path returns `Success` even when zero entries
were found, so `fd` exits with 0 on an empty result. This is the behavior of `stop()` in
`src/walk.rs`: it returns `HasResults(num_results > 0)` only when `config.quiet` is set,
and `Success` otherwise. With `--quiet`, the first matching entry ends the search
immediately with `HasResults(true)`, so the search does not need to finish.

Scripts that need to detect "no match" should therefore use `--quiet` and check the status,
or capture output and test it for emptiness.

### Ctrl-C

When the interrupt flag is set, the receiver returns `KilledBySigint`, and `scan` reports
it even if the receiver's own result was otherwise successful. `ExitCode::exit` then
restores the default SIGINT disposition and re-raises SIGINT on Unix, so the parent shell
sees the process as terminated by the signal. On other platforms the process simply exits
with 130. A second Ctrl-C calls `exit` directly from the signal handler.

## Merging codes from `--exec`

Command execution produces one code per job or batch, which are merged with
`merge_exitcodes`. The rule is simple: if any input is an error (any value whose integer
form is non-zero, including `KilledBySigint`), the result is `GeneralError`; otherwise
`Success`. The unit tests in `exit_codes.rs` pin this behavior.

Inside `exec/command.rs`, a child process that exits with a non-zero status, or that cannot
be spawned, causes its output buffer to be written and the job to return `GeneralError`.
`--exec` therefore does not report the child's own exit status; it reports only success or
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
failure. See [Command Execution](/openwiki/workflows/command-execution.md).

## Error messages

- **Errors**: `print_error` writes `[fd error]: <message>` to stderr. Messages include
  invalid search roots, malformed ignore or exclude patterns, invalid time or size
  arguments, and unwritable output. Fatal errors returned from `run` are printed by
  `main` through the same channel and then exit with `GeneralError`.
- **Filesystem warnings**: traversal errors such as permission-denied directories are
  printed only when `--show-errors` is set. Without the flag they are dropped silently,
  and traversal continues.
- **Broken pipes**: a broken pipe on write is ignored so that piping into `head` is quiet.
  A failed flush ends the run with `GeneralError` and no message.

## Terminal sanitization

Filenames can contain control characters that would change the terminal state when
printed. `print_error` and the entry printer both call `maybe_sanitize`, which escapes
output only when the destination is a terminal. `sanitize_for_terminal` replaces control,
bidi-override, zero-width, and language-tag characters with `\xNN` or `\u{NNNN}` escapes,
and leaves tabs and printable text alone. When output is redirected, bytes pass through
unchanged so that scripts receive exact names. See
<!-- openwiki: broken internal link [/openwiki/workflows/output-and-formatting.md] link "/openwiki/workflows/output-and-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Output and Formatting](/openwiki/workflows/output-and-formatting.md).

## Invariants

- An error returned from any startup step aborts before traversal starts, so no partial
  results are printed for a bad pattern or root.
- `GeneralError` is never converted back to success by later code; `merge_exitcodes`
  is the only place that combines codes.
- Errors go to stderr and results go to stdout, so output from a successful search can be
  piped even when some directories were unreadable.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Parallel Traversal](/openwiki/architecture/parallel-traversal.md)
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Command Execution](/openwiki/workflows/command-execution.md)
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)
