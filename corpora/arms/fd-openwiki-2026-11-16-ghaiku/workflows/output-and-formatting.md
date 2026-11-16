---
type: workflow
title: Output and Formatting
description: How matched entries are written to stdout, covering the three rendering paths (plain, colorized, and --format templates), path display rules such as stripped ./ prefixes and directory separators, null-separated output, OSC 8 hyperlinks, terminal escaping, and the placeholder syntax of --format.
tags: [output, formatting, colors, ls-colors, hyperlinks, format-template, print0, sanitization]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-82ad9015e8518df8ee697487
    resource: repo://src/fmt/mod.rs
  - id: openwiki-source-bdffa7be827daa0dba122070
    resource: repo://src/hyperlink.rs
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Output and Formatting

Printing is handled by the receiver in `src/walk.rs`, which calls `output::print_entry` for
every entry it accepts while in printing mode. That function decides how the path is
rendered: as plain text, as colored text using `LS_COLORS`, or through a `--format`
template. Each entry is then optionally wrapped in an OSC 8 hyperlink and terminated by a
newline or a NUL byte. This page describes those steps and the helpers they use. The
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
receiver's buffering and sorting are covered in [Parallel Traversal](/openwiki/architecture/parallel-traversal.md).

## Entry rendering pipeline

`print_entry` in `src/output.rs` runs these steps for each entry:

1. **Hyperlink start.** If hyperlinks are enabled, an OSC 8 sequence containing a `file://` URL
   for the absolute path is written first.
2. **Body.** One of three renderers runs, chosen in this order:
   - `--format` set: `print_entry_format`.
   - Colors enabled (`ls_colors` present): `print_entry_colorized`.
   - Otherwise: `print_entry_uncolorized`, whose Unix and non-Unix variants are selected by
     `cfg`.
3. **Hyperlink end.** The OSC 8 terminator is written if a hyperlink was opened.
4. **Terminator.** A NUL byte when `--print0` is set, otherwise a newline.

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Colors are resolved in `construct_config` (see [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)).
Under `--color=auto`, colors are used only for terminals and only when `NO_COLOR` is unset.

## Path display rules

- **Relative `./` prefix.** `DirEntry::stripped_path` removes a leading `./` when
  `strip_cwd_prefix` is true. That setting is on by default when no search path was given and
  output is not NUL-separated and no command runs. A path starting with `-` keeps its prefix so
  it is not read as an option by later tools.
- **Path separator.** `--path-separator` replaces every `/` or native separator in the printed
  path (`replace_path_separator`). In `--format` output the same override is applied by the
  template engine.
- **Directory marker.** Entries that are directories get a trailing separator, written by
  `print_trailing_slash` in both the plain and colorized paths. That marker is written in the
  separator's own style, so it is not colored with the name.
- **Absolute output.** `-a`/`--absolute-path` converts the search roots to absolute paths before
  the walk, so printed results carry absolute prefixes. See
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md).

## Colorized output

`print_entry_colorized` splits the path into a parent portion and a basename. The parent (and the
separators after it) is painted with the directory style from `LS_COLORS`. The basename is
painted with `DirEntry::style`, which picks a style from the entry's file type and extension.
The trailing directory marker follows the directory style.

`LS_COLORS` comes from the environment when present. Otherwise the built-in `DEFAULT_LS_COLORS`
string in `src/main.rs` is used.

## Format templates (`--format`)

`--format` takes a template parsed by `FormatTemplate::parse`. Recognized placeholders are:

| Placeholder | Replacement |
| --- | --- |
| `{}` | The path. |
| `{/}` | The basename. |
| `{//}` | The parent directory, or `.` when there is none. |
| `{.}` | The path without its extension. |
| `{/.}` | The basename without its extension. |
| `{{` and `}}` | Literal braces. |

Parsing uses an Aho-Corasick automaton over these patterns, so a template is scanned once. Text
between placeholders is kept verbatim. The path handed to a placeholder is the stripped path, so
`./` prefixes do not appear. When a path separator override is set, the template engine
rewrites the separators in the output, and it converts Windows prefixes and roots into the
chosen separator.

The rendered output is passed through `maybe_sanitize` and printed without colors. Hyperlinks still
wrap the output when enabled, and the `--format` output still ends with the usual newline or NUL.

## Null-separated output

`-0`/`--print0` replaces the newline after each entry with a NUL byte. It is the usual companion of
`xargs -0`. The same flag also affects `--exec` output buffering and the default strip-prefix rule.

## Hyperlinks

When hyperlinks are enabled (`--hyperlink`, or `auto` with colors on), each path is wrapped in an
OSC 8 sequence:

```
ESC ] 8 ; ; file://<host>/<encoded absolute path> ESC \ <path> ESC ] 8 ; ; ESC \
```

`PathUrl` percent-encodes every byte outside a conservative ASCII set, so non-ASCII names do not
depend on UTF-8 validity. The host is the machine name on Unix and `/` elsewhere; see
<!-- openwiki: broken internal link [/openwiki/concepts/platform-support.md] link "/openwiki/concepts/platform-support.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Platform-Specific Behavior](/openwiki/concepts/platform-support.md).

## Terminal sanitization

Printing to a terminal escapes control characters, bidirectional overrides, zero-width and format
characters, and language tags in file names. Redirected output is written unchanged. The
sanitization decision is made per output using `config.interactive_terminal`, and the same helper
<!-- openwiki: broken internal link [/openwiki/concepts/exit-codes-and-errors.md] link "/openwiki/concepts/exit-codes-and-errors.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
protects error messages. The rules are described in [Exit Codes and Error Reporting](/openwiki/concepts/exit-codes-and-errors.md).

## Invariants and gotchas

- Only the receiver writes entries to stdout in printing mode, so entries are never interleaved
  with one another.
- Formatting is computed per entry on the receiver thread. Heavy templates slow the whole
  pipeline, not just the workers.
- Colors are never applied to `--format` output. Scripts that need color should use the default
  renderer.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Parallel Traversal](/openwiki/architecture/parallel-traversal.md)
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Command Execution](/openwiki/workflows/command-execution.md)
<!-- openwiki: broken internal link [/openwiki/concepts/exit-codes-and-errors.md] link "/openwiki/concepts/exit-codes-and-errors.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Exit Codes and Error Reporting](/openwiki/concepts/exit-codes-and-errors.md)
