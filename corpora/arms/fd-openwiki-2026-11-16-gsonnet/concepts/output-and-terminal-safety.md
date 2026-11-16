---
type: concept
title: Output Rendering, Colors, Hyperlinks and Terminal Sanitization
description: How fd prints each result - LS_COLORS styling, ./ prefix stripping, path separator override, --format templates, OSC 8 hyperlinks - and how filenames and error messages are sanitized to prevent terminal escape injection.
tags: [output, colors, hyperlinks, sanitization, security, terminal]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-bdffa7be827daa0dba122070
    resource: repo://src/hyperlink.rs
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# Output Rendering, Colors, Hyperlinks and Terminal Sanitization

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-walk-and-receiver.md] link "/openwiki/architecture/parallel-walk-and-receiver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
All printed results go through `output::print_entry` (`src/output.rs`), called by the receiver ([parallel walk](/openwiki/architecture/parallel-walk-and-receiver.md)) with a locked, buffered stdout. Whether fd is in a "terminal" mode is captured once as `Config.interactive_terminal` (stdout is a TTY).

## Rendering pipeline for one entry

1. **Hyperlink wrapper** (`--hyperlink`): if enabled and the path can be made absolute, writes an OSC 8 opener `ESC ] 8 ; ; file://<host><percent-encoded path> ESC \` before the text and the closer after it. `PathUrl` (`src/hyperlink.rs`) percent-encodes every byte except ASCII alphanumerics and `/ : - . _ ~` (on Windows `\` becomes `/`), and the host comes from `gethostname` on Unix (cached in a `OnceLock`, empty elsewhere). Encoding all non-ASCII bytes keeps URLs valid even for non-UTF-8 paths.
2. **Body**, exactly one of:
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
   - `--format <template>`: `print_entry_format` renders the template with `FormatTemplate::generate` against the stripped path. This is the same placeholder engine used by `--exec` ([command execution](/openwiki/workflows/command-execution.md)).
   - **Colorized** (when `Config.ls_colors` is set): the parent-directory portion (including its trailing separator) is painted with the LS_COLORS *directory* style, the basename with the entry's own style (`DirEntry::style`, precomputed on walker threads and cached), then a trailing separator for directories.
   - **Plain**: path text, plus a trailing separator for directories.
3. **Terminator**: `\0` with `--print0`, otherwise a newline.

Details:

- **Path separator**: `--path-separator` (or the MSYS default) replaces `std::path::MAIN_SEPARATOR` in the printed path; the trailing slash for directories uses `Config.actual_path_separator`.
- **Prefix stripping**: output uses `DirEntry::stripped_path`, so `./` is dropped when `strip_cwd_prefix` is on (default for plain printing without explicit search roots), but never when that would yield a name beginning with `-`.
- **Unix fast path**: when not on a terminal and no custom separator is set, plain output writes the raw OS bytes (`as_bytes()`), so invalid UTF-8 names are emitted unchanged instead of lossily converted. Otherwise paths go through `to_string_lossy`.
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Colors** are enabled by [config construction](/openwiki/architecture/cli-and-configuration.md) (`--color`, `NO_COLOR`, TTY detection) and use `LS_COLORS` from the environment or a built-in default theme.

## Terminal escape injection defense (`src/sanitize.rs`)

A filename can contain control sequences (e.g. OSC 52 clipboard writes, cursor movement, bidi overrides), which would be executed by a terminal merely by listing the directory. `sanitize_for_terminal` escapes every char for which `needs_escape` is true: C0/C1 controls and DEL (via `char::is_control`, except TAB), soft hyphen, Mongolian vowel separator, zero-width and LRM/RLM marks, bidi embeddings/overrides, word-joiner/invisible/format characters, BOM, interlinear annotations, and tag characters. They are rendered visibly as `\xNN` (≤ 0xFF) or `\u{NNNN}`. When nothing needs escaping it returns a borrowed `Cow`, so the common case allocates nothing.

`maybe_sanitize(s, is_terminal)` applies this *only* when the destination is a terminal; pipes and files receive raw bytes so downstream tools (e.g. `xargs -0`) see the true names. It is used for:

- plain and colorized path output and `--format` output (stdout TTY check from `Config.interactive_terminal`),
- parent and basename segments separately in colorized mode (so escapes are applied *before* painting with ANSI styles),
- error messages: `print_error` (`src/error.rs`) formats as `[fd error]: <msg>` and sanitizes when **stderr** is a terminal, since errors often embed user-controlled paths or patterns.

Note that sanitization is not applied to the executed command's own output or arguments - `--exec` passes real paths to the child process.

## Failure behavior

<!-- openwiki: broken internal link [/openwiki/operations/exit-codes-and-error-handling.md] link "/openwiki/operations/exit-codes-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Write errors other than `BrokenPipe` are reported by the receiver and produce `GeneralError`; a `BrokenPipe` is silently ignored so `fd | head` exits cleanly (see [exit codes](/openwiki/operations/exit-codes-and-error-handling.md)).

## Tests

<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Unit tests in `src/sanitize.rs` (safe content preserved, OSC 52 payloads neutralized) and integration tests `test_hyperlink`, `test_custom_path_separator`, `test_print0`, `test_strip_cwd_prefix`, `test_invalid_utf8` in `tests/tests.rs` ([harness](/openwiki/testing/integration-test-harness.md)).
