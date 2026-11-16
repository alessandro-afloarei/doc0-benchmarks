---
type: workflow
title: Output Formatting, Colors and Terminal Safety
description: How fd prints a matched entry - the per-entry writer in src/output.rs for plain, colorized, --format and hyperlink output; trailing slashes and path separators; raw bytes for pipes; terminal sanitization of control characters; and null-separated output.
tags: [output, colors, ls-colors, format, hyperlink, osc8, sanitize, terminal, null-separator]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:10:54.611Z
sources:
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-bdffa7be827daa0dba122070
    resource: repo://src/hyperlink.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
generated: { by: "claude-code", at: "2026-11-16T18:10:54.611Z" }
---

# Output Formatting, Colors and Terminal Safety

Printing happens in two places. The receiver in `src/walk.rs` decides *when*
entries are written (buffered or streamed; see
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Parallel Traversal](/openwiki/architecture/parallel-traversal.md)). The writer
in `src/output.rs` decides *what bytes* are written for one entry. This page
covers the second part and the helpers it uses.

## Per-entry writer

`output::print_entry(stdout, entry, config)` writes one entry. Its steps:

1. If `config.hyperlink` is on and the entry's absolute path can be converted to
   a `file://` URL (`hyperlink::PathUrl`), an OSC 8 opening sequence is written
   first: `ESC ] 8 ; ; <url> ESC \`.
2. The body is written by exactly one of three renderers, chosen in this order:
   - `--format` template (`print_entry_format`), when `config.format` is set;
   - colorized output (`print_entry_colorized`), when `config.ls_colors` is set;
   - plain output (`print_entry_uncolorized`), otherwise.
3. If a hyperlink was opened, the closing OSC 8 sequence is written.
4. The terminator is a NUL byte when `--print0` (`null_separator`) is set and a
   newline otherwise.

`config.ls_colors` is `Some` only when colors are enabled. Colors are decided in
`construct_config` from `--color` and, for `auto`, from whether stdout is a
terminal, whether `NO_COLOR` is unset, and whether ANSI support is available.
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
See [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md).

## Path text

Every renderer starts from `DirEntry::stripped_path`, which removes a leading
`./` from relative results so `fd` prints `src/main.rs` rather than
`./src/main.rs`. The exception is a path whose stripped form would begin with
`-`, which keeps the `./` so that downstream tools do not read the path as an
option.

`--path-separator SEP` replaces the platform separator in the printed text.
On Windows MSYS environments the default separator is `/`
(`filesystem::default_path_separator`).

Directories get a trailing separator when printed by the plain and colorized
renderers. The separator is the configured `actual_path_separator`, and it is
not colored. The `--format` renderer does not add a trailing separator, because
the template fully controls its output.

## Plain output

`print_entry_uncolorized` has two behaviors on Unix:

- When stdout is an interactive terminal, or `--path-separator` is set, the path
  string is converted with `to_string_lossy`, the separator is replaced if
  needed, and the result is passed through `maybe_sanitize` (below).
- When output is piped or redirected and no separator is set, the raw
  `OsStr` bytes are written unchanged. This keeps non-UTF-8 file names intact
  for downstream tools. Only the trailing separator is added as text.

On non-Unix platforms the first behavior is always used.

## Colorized output

`print_entry_colorized` splits the printed path into two parts:

- The parent directory portion (everything up to and including the separators
  after the last component) is painted with the LS_COLORS style for the
  directory indicator.
- The file name portion is painted with the style computed for the entry by
  `DirEntry::style`, which uses `lscolors` and the entry's metadata. Style
  computation happens in the sender, in parallel with the walk.

A trailing separator for a directory is painted with the directory indicator
style. Colors come from the `LS_COLORS` environment variable when it is set;
otherwise `fd` uses a built-in default palette (`DEFAULT_LS_COLORS` in
`src/main.rs`).

## `--format` templates

`--format TEMPLATE` is parsed by `FormatTemplate::parse` and expanded per entry
with `generate`. The tokens are the same as for `--exec` placeholders (`{}`,
`{/}`, `{//}`, `{.}`, `{/.}`), plus the `{{` and `}}` escapes. The template is
applied to the stripped path, and `--path-separator` applies to the generated
text. The renderer converts the result with `to_string_lossy` before
sanitizing it, so a `--format` line for a non-UTF-8 name is lossy.

Because `--format` replaces the whole line, it does not add colors or a
trailing separator. Hyperlinks, if enabled, still wrap the output.

## Terminal sanitization

File names can contain control characters, including escape sequences, which a
terminal would interpret. `sanitize.rs` guards against that:

- `sanitize_for_terminal` replaces characters that are not printable, except
  tab, with escapes. Characters up to `0xFF` become `\xHH`; higher code points
  become `\u{HHHH}`. The set includes C0 and C1 controls, DEL, bidirectional
  overrides, zero-width and format characters, interlinear annotations, and
  Unicode tag characters.
- `maybe_sanitize(s, is_terminal)` applies that escaping only when the output
  is a terminal. Pipes and files receive the raw bytes, so tools that consume
  `fd` output see the original names.

`error::print_error` uses the same helper with the stderr terminal check, so
error messages that include file names are also safe.

## Hyperlinks (OSC 8)

With `--hyperlink`, or with `auto` when colors are enabled, each entry is
wrapped in an OSC 8 `file://` link. `hyperlink::PathUrl` makes the path
absolute, keeps ASCII letters, digits and the characters `/ : - . _ ~`, and
percent-encodes all other bytes. On Unix the host part comes from the system
hostname, obtained once and cached; on Windows backslashes become forward
slashes.

## Output buffering and flushing

Entries are written to a `BufWriter` around locked stdout by the receiver.
Buffered mode collects entries and writes them sorted at the end of a quick
search. Streaming mode writes and flushes as batches arrive. A broken pipe
during a write is not reported as an error. See
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Parallel Traversal](/openwiki/architecture/parallel-traversal.md) for the
receiver's details.

## Extension seams

- New output modes belong in `print_entry`, next to the existing three
  renderers, so the hyperlink and null-separator logic stays shared.
- Changes to escaping rules belong in `sanitize.rs`, which is also used by
  error printing.
- New `--format` tokens go into `fmt/mod.rs` so that `--exec` gets them too.

## Tests

Integration tests cover output in `tests/tests.rs`, for example `test_print0`,
`test_absolute_path`, `test_custom_path_separator`, `test_strip_cwd_prefix`,
`test_hyperlink` and `test_invalid_utf8`. Unit tests in `src/sanitize.rs`,
`src/fmt/mod.rs` and `src/fmt/input.rs` cover escaping and template parsing.
<!-- openwiki: broken internal link [/openwiki/testing/integration-tests.md] link "/openwiki/testing/integration-tests.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
See [Testing Strategy](/openwiki/testing/integration-tests.md).

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Parallel Directory Traversal](/openwiki/architecture/parallel-traversal.md)
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Command Execution](/openwiki/workflows/command-execution.md)
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)
