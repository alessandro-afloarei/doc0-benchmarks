---
type: workflow
title: Output formatting and shell pipelines
description: Printing order, terminal escaping, raw Unix paths, colors, hyperlinks, formatting templates and search exit status.
tags: [output, pipelines, terminal, formatting, exit-status]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:13:39.635Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "codex", at: "2026-11-16T17:13:39.635Z" }
---

# Output formatting and shell pipelines

The printing receiver owns stdout and decides when results are sorted or streamed. `output::print_entry` renders each entry, optionally surrounds it with a hyperlink, and appends a newline or NUL. Command execution has a separate output path described in [executing commands](command-execution.md).

## Buffering and ordering

`ReceiverBuffer` begins in buffering mode with a default deadline of 100 milliseconds. If the search finishes while still buffering, it sorts entries by path before printing. When the deadline expires or the buffer grows beyond 1,000 entries, it switches permanently to streaming and flushes the current buffer in arrival order. A configured `--max-buffer-time` changes the deadline. Therefore output is not globally sorted for every search, and a fast sample run does not establish an ordering guarantee. See [buffer thresholds](../../src/walk.rs#L124-L169) and [receiver transitions](../../src/walk.rs#L197-L301).

`--max-results N` counts accepted entries in the printing receiver and stops at the limit; zero means no limit. `-1` selects one result. These select arrivals from parallel traversal, not the lexically smallest paths. Quiet mode stops on the first entry without printing. Receiver termination sets the quit flag so workers can stop. See [result handling](../../src/walk.rs#L173-L225) and [limit resolution](../../src/cli.rs#L759-L762).

## Terminal display and byte-preserving pipelines

All normal string-rendering paths sanitize displayed filenames when stdout is a terminal. The sanitizer escapes control characters except horizontal tab, plus selected invisible and bidirectional-format characters, into visible hexadecimal forms. Ordinary printable Unicode is retained. Sanitization depends on terminal detection, not on color selection. See [sanitize.rs](../../src/sanitize.rs#L6-L55).

On Unix, uncolored output to a pipe or file with no custom path separator writes raw filename bytes. This preserves invalid UTF-8 paths. Colored output, custom formatting, terminal display and custom-separator output instead use lossy string conversion. Adding `--format` therefore changes the byte-fidelity contract even if its template is just `{}`. Non-Unix uncolored output also uses the string path. See [rendering branches](../../src/output.rs#L69-L85) and [uncolored output](../../src/output.rs#L142-L182).

For a NUL-delimited file list on a Unix-like shell:

```sh
fd -t f -0 --color=never --hyperlink=never . src | xargs -0 wc -l
```

The explicit rendering flags ensure a plain path stream. NUL delimiters handle embedded newlines, whereas line-based consumers cannot distinguish those from entry boundaries. `fd -t f . src -X wc -l` uses fd's own batch execution instead; its empty-result and argument-limit behavior is described in the [execution guide](command-execution.md).

Ordinary path printing appends a separator to directory results. Formatting templates do not append it automatically. With implicit current-directory searches, normal printing strips `./` by default, while NUL output and command execution retain it by default. Even when stripping is enabled, a prefix is preserved if removing it would expose a leading dash. See [directory rendering](../../src/output.rs#L49-L65), [prefix policy](../../src/main.rs#L389-L390), and [DirEntry path handling](../../src/dir_entry.rs#L56-L79).

## Styling, hyperlinks and templates

Automatic colors require a terminal, supported ANSI behavior, and no nonempty `NO_COLOR`. Explicit always/never modes override that automatic decision. Enabled colors load `LS_COLORS` or fd's embedded default. Parent components are styled as directories; the basename uses the entry's cached style. See [color configuration](../../src/main.rs#L271-L292) and [color renderer](../../src/output.rs#L89-L138).

Hyperlinks default to never. Bare `--hyperlink` means auto, and auto follows whether colored output is enabled. When enabled and an absolute path can be built, fd wraps the rendered entry in OSC 8 escapes with a `file://` URL. The URL percent-encodes unsafe and non-ASCII bytes; Windows backslashes become forward slashes. Unix hosts are obtained once and cached. See [hyperlink options](../../src/cli.rs#L532-L548), [configuration](../../src/main.rs#L293-L297), and [URL construction](../../src/hyperlink.rs#L7-L61).

`--format` selects the shared `FormatTemplate` renderer ahead of the color branch:

```sh
fd -t f -e rs --format '{//}: {/}'
```

It supports `{}`, `{/}`, `{//}`, `{.}`, `{/.}`, and doubled braces for literals. `--path-separator` changes path tokens without changing literal text in a template. A final newline or NUL still comes from `print_entry`; an enabled hyperlink still surrounds formatted output. See [dispatch](../../src/output.rs#L17-L42) and [template expansion](../../src/fmt/mod.rs#L58-L140).

## Exit status and write failures

| Situation | fd outcome |
| --- | --- |
| Ordinary completed search, including no matches | 0 |
| Quiet search with a match | 0 |
| Quiet search without a match | 1 |
| Setup or execution general error | 1 |
| Recorded interrupt | 130 fallback; Unix attempts to restore and raise SIGINT |

Walk errors are only displayed with `--show-errors` and do not by themselves change the normal printing receiver's final success. In `print`, a broken-pipe write error is ignored, but other write errors are reported as general errors; `flush` returns a general error for any flush failure. Consequently, do not promise that every early-closing downstream consumer produces exit code zero. See [receiver errors](../../src/walk.rs#L227-L301) and [exit-code implementation](../../src/exit_codes.rs#L14-L43).

Tests include `test_print0`, `test_invalid_utf8`, `test_custom_path_separator`, `test_strip_cwd_prefix`, `test_quiet`, `test_max_results`, `format`, and `test_hyperlink`. Sanitizer unit tests cover terminal control payloads, newlines and invisible Unicode; hyperlink tests check byte encoding. Use raw output assertions when validating bytes or order, as explained in the [test guide](../operations/build-test-release.md).

Related: [traversal](../architecture/traversal-and-ignores.md), [command execution](command-execution.md), [quickstart](../quickstart.md).
