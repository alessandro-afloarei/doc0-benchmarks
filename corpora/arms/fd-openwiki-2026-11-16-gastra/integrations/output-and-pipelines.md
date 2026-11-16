---
type: integration
title: Output, paths, and shell pipelines
description: fd result ordering, terminal rendering, raw-byte pipeline output, formatting, hyperlinks, and exit-status behavior.
tags: [output, terminal, pipelines, encoding, integration]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:26:52.841Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-bdffa7be827daa0dba122070
    resource: repo://src/hyperlink.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "codex", at: "2026-11-16T07:26:52.841Z" }
---

# Output, paths, and shell pipelines

Listing results pass through `ReceiverBuffer` in `walk.rs` and `print_entry` in `output.rs`. Command execution has a separate output path; consult [command execution](../workflows/command-execution.md) for child-process buffering and status aggregation.

## Ordering and latency

The printer initially accumulates results for up to 100 ms by default. If traversal finishes while still buffering, it sorts by path before printing. Crossing the deadline or exceeding 1000 buffered entries switches to streaming, flushing the existing buffer without sorting. Streaming order follows parallel arrival and is not a stable ordering contract. A result limit counts received entries and stops at the configured count; it does not select the globally first paths in lexical order. `--max-buffer-time` changes the buffering deadline. [Buffer policy](../../src/walk.rs#L124-L169), [receiver](../../src/walk.rs#L198-L249), [sort and flush](../../src/walk.rs#L269-L302).

## Paths and delimiters

Ordinary listing prints a newline after each result, or NUL with `--print0` / `-0`. Plain and colored listing append the configured separator to directory paths. `--format` uses the shared placeholder template engine and bypasses ordinary colorized/plain path rendering, including its automatic directory suffix. [Rendering dispatch](../../src/output.rs#L16-L86).

For implicit current-directory searches, `./` is normally stripped for human-readable output. Automatic stripping is disabled for NUL output and command execution. Explicit root arguments prevent this stripping option from applying; when stripping would expose a leading `-`, `DirEntry` keeps the prefix to prevent downstream option interpretation. [Configuration](../../src/main.rs#L389-L390), [eligibility](../../src/cli.rs#L765-L773), [dash protection](../../src/dir_entry.rs#L56-L79).

`--absolute-path` controls root/output normalization, while `--full-path` controls the matching candidate. A custom `--path-separator` rewrites presentation and template substitutions; it does not change filesystem traversal. See [search semantics](../concepts/search-semantics.md).

## Terminal safety and filename bytes

When stdout is a terminal, filename text is sanitized in plain, colored, and formatted output. Control characters and selected invisible or bidirectional formatting characters become visible `\xNN` or `\u{NNNN}` escapes; tab remains allowed. The sanitizer is independent of whether color is enabled, and returns ordinary printable text without allocating a replacement. Unit tests cover embedded terminal escape sequences, carriage return, newline, and Unicode formatting characters. [Sanitizer](../../src/sanitize.rs#L6-L55), [tests](../../src/sanitize.rs#L61-L139).

On Unix, ordinary uncolored output to a pipe/file writes raw filename bytes when no custom path separator is set. This preserves invalid UTF-8 names. Formatted, colored, custom-separator, and non-Unix plain output use lossy string conversion, so they are not interchangeable with that raw-byte path. NUL delimiting handles embedded newlines, but does not undo a lossy conversion already selected by a formatting mode. [Unix output](../../src/output.rs#L142-L182), [formatted output](../../src/output.rs#L69-L85).

For a NUL-aware Unix consumer, search all Rust files beneath `src` with an explicit match-all pattern:

```sh
fd -t f -e rs --color never --hyperlink never -0 . src |
  xargs -0 wc -l
```

The direct batch equivalent is `fd -t f -e rs . src -X wc -l`. Use the direct execution mode when it fits the task; it passes paths as arguments without parsing listing text. For deterministic ordering, add a downstream sorter that supports your delimiter rather than depending on fd's short-search sorting.

## Color and hyperlinks

Auto color requires terminal stdout, ANSI support, and an absent or empty `NO_COLOR`. Explicit `--color always` or `never` selects the other branches. Enabled colors come from `LS_COLORS`, with a built-in fallback. Auto hyperlink mode follows color enablement; explicit hyperlink settings are separate. [Presentation configuration](../../src/main.rs#L271-L297).

Hyperlinks wrap each rendered entry in OSC 8 sequences using an absolute `file://` URL. Unsafe path bytes, including non-ASCII bytes, are percent-encoded, and Windows backslashes become `/`. If absolute-path construction fails, the entry prints without a hyperlink. This URL encoding and filename sanitization serve different output boundaries. [Hyperlink wrapper](../../src/output.rs#L17-L36), [URL encoding](../../src/hyperlink.rs#L7-L40).

## Exit behavior and errors

| Situation | Status behavior |
| --- | --- |
| Ordinary completed listing, including no matches | Success (`0`) |
| Quiet search (`--quiet` / `-q`) | First match returns `0`; no match returns `1` |
| Startup or command failure | General error (`1`), rather than preserving the child's exact code |
| Explicit interrupt exit | `130`; Unix also attempts to restore and raise SIGINT |

Walk errors are diagnostic events printed only with `--show-errors`; they do not by themselves fail normal listing. In the printer, an individual write error with kind `BrokenPipe` is ignored, other write errors fail, and a flush error returns general error. Do not infer unconditional successful exit from the presence of a downstream consumer such as `head`. [Receiver handling](../../src/walk.rs#L198-L302), [exit mapping](../../src/exit_codes.rs#L6-L43).

The [pipeline architecture](../architecture/search-pipeline.md) explains cancellation and channel ownership. Regression coverage includes `test_print0`, `test_invalid_utf8`, `test_quiet`, `test_strip_cwd_prefix`, and `test_hyperlink` in `tests/tests.rs`, plus sanitizer and hyperlink unit tests.
