---
type: feature
title: Output Formatting, Colors, Hyperlinks, and Sanitization
description: How fd prints each result — the --format template, LS_COLORS-based colorization, raw-byte output on pipes, trailing directory separators, custom path separators, ./ prefix stripping, null separators, OSC 8 hyperlinks, and sanitization of control characters for terminals.
tags: [output, colors, ls-colors, hyperlinks, sanitization, format]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-82ad9015e8518df8ee697487
    resource: repo://src/fmt/mod.rs
  - id: openwiki-source-bdffa7be827daa0dba122070
    resource: repo://src/hyperlink.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Output Formatting, Colors, Hyperlinks, and Sanitization

When no command is configured, the receiver
([Parallel Walk](../architecture/parallel-walk-and-receiver.md)) writes each
result through `output::print_entry` (`src/output.rs`) into a buffered, locked
stdout. Presentation decisions are all precomputed in `Config` by
`construct_config` ([Search Pipeline](../architecture/search-pipeline.md)).

## `print_entry` structure

For every entry:

1. If hyperlinks are enabled and the absolute path can be resolved, open an OSC 8
   hyperlink (`ESC ]8;;file://host/path ESC \`).
2. Print the path in exactly one of three modes:
   - `--format <template>` → `print_entry_format`;
   - colors enabled (`Config.ls_colors` is `Some`) → `print_entry_colorized`;
   - otherwise → `print_entry_uncolorized`.
3. Close the hyperlink if one was opened.
4. Terminate with `\0` (`-0/--print0`) or `\n`.

## Which path is printed

All modes use `DirEntry::stripped_path(config)`:

- When `strip_cwd_prefix` is true, a leading `./` is removed — *except* when the
  remainder would start with `-`, in which case `./` is kept so the output cannot
  be mistaken for an option.
- `strip_cwd_prefix` is only possible when no explicit search path was given.
  `--strip-cwd-prefix[=always|never|auto]` controls it; `auto` (default) strips
  unless `--print0` or a command is in use. It conflicts with explicit paths.
- With `-a/--absolute-path`, search roots are made absolute up front, so all
  results are absolute.

## Colorized output

Colors are on with `--color always`, off with `never`, and under `auto` only when
stdout is a terminal, `NO_COLOR` is unset/empty, and ANSI is supported (on Windows,
`enable_ansi_support()` succeeds or `TERM` is set). The palette comes from
`LS_COLORS`, or a built-in default generated with `vivid` (molokai theme) when the
variable is absent.

`print_entry_colorized` splits the path at the parent: the directory prefix
(including the trailing separator run) is painted with the LS_COLORS directory
style, and the final component with the entry's own style (by type/extension,
looked up via `lscolors::Colorable` on `DirEntry` and cached; usually already
computed in a worker thread). Directories get a trailing path separator painted
in the directory style. `--path-separator` replaces separators in the parent
portion.

## Uncolorized output

- Directories always get a trailing separator (`actual_path_separator`, i.e. the
  custom separator or the OS default).
- On Unix, when stdout is **not** a terminal and no custom separator is set, the
  path is written as raw `OsStr` bytes so invalid UTF-8 file names reach
  downstream tools intact.
- Otherwise the path is converted with `to_string_lossy`, separators are
  replaced if requested, and the text is sanitized for terminal display.

## `--format` and the `FormatTemplate` engine

`--format` (conflicts with `--list-details`) is parsed once by
`FormatTemplate::parse` (`src/fmt/mod.rs`). Parsing uses an Aho-Corasick
automaton over `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}`, `{/.}`:

- `{{`/`}}` produce literal braces; a placeholder followed by `}` is treated as
  escaped text.
- A string with no placeholders becomes `FormatTemplate::Text`; otherwise a list
  of `Token`s.

`generate(path, separator)` expands tokens using helpers in `src/fmt/input.rs`:
`basename` (file name), `dirname` (parent, or `.` for bare names),
`remove_extension` (dirname joined with file stem, `./` stripped). Custom
separators are applied by rebuilding the path from its components (including
Windows UNC prefixes) only for placeholder tokens. The same engine powers
`--exec` / `--exec-batch` arguments ([Command Execution](command-execution.md)).
Formatted output is lossily converted to UTF-8 and sanitized on terminals.

## Hyperlinks

`--hyperlink[=auto|always|never]` (alias `--hyper`; default `never`, bare flag
means `auto`) adds OSC 8 links; `auto` follows the color decision. `PathUrl`
(`src/hyperlink.rs`) builds `file://<host><absolute path>`: on Unix the host is the
cached `gethostname()` result; elsewhere the host part is `/`. Every byte outside
`[0-9A-Za-z/:._~-]` is percent-encoded (on Windows `\` becomes `/`). Hyperlinks do
nothing for `--exec`/`--exec-batch`.

## Terminal sanitization

File names can contain escape sequences (e.g. an OSC 52 clipboard write). When the
output stream is a terminal, `sanitize::maybe_sanitize` escapes every control
character except tab, plus invisible/format characters (soft hyphen, zero-width
characters, bidi overrides, word joiners, BOM, interlinear annotations, tag
characters): code points ≤ 0xFF become `\xNN`, others `\u{NNNN}`. Strings without
such characters are borrowed unchanged. Pipes and files receive the original
text. Error messages on stderr (`print_error`) are sanitized the same way when
stderr is a terminal.

## Tests

- `src/sanitize.rs`: preservation of safe Unicode and stripping of OSC 52, CSI,
  bidi and other payloads.
- `src/hyperlink.rs`: percent-encoding (`test_unicode_encoding`).
- `src/fmt/mod.rs` / `src/fmt/input.rs`: template parsing and path helpers.
- `tests/tests.rs`: `test_print0`, `test_custom_path_separator`,
  `test_strip_cwd_prefix`, `test_hyperlink`, `test_invalid_utf8`, and `--format`
  cases.
