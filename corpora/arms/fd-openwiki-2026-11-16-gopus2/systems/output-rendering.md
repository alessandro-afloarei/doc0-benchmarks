---
type: system
title: Output Rendering
description: How fd writes each search result - the format-template, LS_COLORS-colorized and uncolorized printing paths, placeholder templates, custom path separators, trailing directory separators, null separators, OSC 8 hyperlinks, terminal escape sanitization, raw-byte output for pipes, and ./ prefix stripping.
tags: [output, colors, ls-colors, format, hyperlink, sanitization, path-separator]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:22.809Z
sources:
  - id: openwiki-source-2deefc22f345fd7e2c28832d
    resource: repo://src/fmt/input.rs
  - id: openwiki-source-82ad9015e8518df8ee697487
    resource: repo://src/fmt/mod.rs
  - id: openwiki-source-bdffa7be827daa0dba122070
    resource: repo://src/hyperlink.rs
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
generated: { by: "claude-code", at: "2026-11-16T16:28:22.809Z" }
---

# Output Rendering

When no command is configured, the walker's receiver (see [Parallel Walk Pipeline](../architecture/parallel-walk-pipeline.md)) calls `output::print_entry(stdout, entry, config)` for each result. `stdout` is a locked `BufWriter`, flushed by the receiver.

## `print_entry` structure (`src/output.rs`)

```text
[OSC 8 open]  ── if config.hyperlink and the path can be made absolute
body          ── exactly one of:
                 --format template  → print_entry_format
                 colors enabled     → print_entry_colorized
                 otherwise          → print_entry_uncolorized
[OSC 8 close]
terminator    ── "\0" with -0/--print0, else "\n"
```

### Format path (`--format <fmt>`)

The template (parsed once into `Config.format`) is expanded against `entry.stripped_path(config)` with `--path-separator` applied to placeholders, converted lossily to UTF-8 and sanitized when stdout is a terminal. No colors and **no trailing directory separator** are added. `--format` conflicts with `--list-details`.

### Colorized path

- The parent portion (everything up to and including the separators before the file name) is painted with the `LS_COLORS` *directory* style (`Indicator::Directory`), after optional separator replacement.
- The file name is painted with the entry's own style, `entry.style(ls_colors)` — usually precomputed on the walker thread.
- Directories get a trailing `actual_path_separator`, painted with the directory style.
- Both parts are sanitized separately when stdout is a terminal.

`LS_COLORS` comes from the environment or the built-in default theme in `src/main.rs`; see [CLI Parsing and Config Construction](../architecture/cli-to-config.md#output-related-decisions) for when colors are on.

### Uncolorized path

- On Unix, when stdout is **not** a terminal and no custom `--path-separator` is set, the raw `OsStr` bytes are written. This is what keeps non-UTF-8 file names intact for pipelines (`test_invalid_utf8`).
- Otherwise (terminal, Windows, or custom separator): lossy UTF-8, separator replacement, sanitization if on a terminal.
- Directories get a trailing `actual_path_separator` (the custom separator or the platform's `MAIN_SEPARATOR`).

## Path presentation

- **`./` stripping** — `DirEntry::stripped_path` removes the leading `./` when `Config.strip_cwd_prefix` is true (by default: no explicit search path, not `--print0`, no command). If the stripped path would start with `-`, the `./` is kept so the output cannot be mistaken for an option by a downstream tool.
- **Custom separator** — in the printing paths, `replace_path_separator` substitutes `MAIN_SEPARATOR` in the string. In templates, `FormatTemplate::replace_separator` re-joins path *components*, handling Windows drive prefixes (`C:`), UNC prefixes (`\\server\share` → `##server#share` for `#`) and root dirs.
- **Absolute paths** — `-a` makes search roots absolute, so every result is absolute; there is no per-entry conversion in output.

## Format templates (`src/fmt/`)

`FormatTemplate` is shared by `--format` and `--exec` (see [Command Execution](command-execution.md)). `parse` uses an Aho-Corasick automaton (built once in a `OnceLock`) over `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}`, `{/.}`:

- `{{` / `}}` emit a literal brace.
- A placeholder immediately followed by `}` is treated as text plus an escaped brace (e.g. `{.}}` → literal `{.}`).
- A string without placeholders becomes `FormatTemplate::Text`; otherwise `Tokens(Vec<Token>)`.

`generate` expands tokens using helpers in `src/fmt/input.rs`:

- `basename` — `file_name()` or the whole path;
- `dirname` — `parent()`, with an empty parent rendered as `.`;
- `remove_extension` — `dirname/file_stem` with `./` stripped (hidden files like `.foo` keep their name).

## Hyperlinks (`--hyperlink`, `src/hyperlink.rs`)

When enabled (`always`, or `auto` + colors), each entry is wrapped in an OSC 8 sequence `ESC ] 8 ; ; file://<host><path> ESC \`. `PathUrl` makes the path absolute (stripping the `\\?\` verbatim prefix on Windows); the host is the cached `gethostname()` on Unix, or an extra `/` elsewhere. Every byte outside `[0-9A-Za-z/:._~-]` is percent-encoded — including all non-ASCII bytes, since they may not be valid UTF-8 — and `\` becomes `/` on Windows.

## Terminal sanitization (`src/sanitize.rs`)

File names are attacker-controllable, so when writing to a terminal fd escapes characters that could inject terminal control sequences or disguise names:

- all control characters (C0, DEL, C1 such as CSI `U+009B` and OSC `U+009D`) except TAB — including newline and carriage return;
- soft hyphen, Mongolian vowel separator, zero-width chars and LRM/RLM (`U+200B–U+200F`), bidi embeddings/overrides (`U+202A–U+202E`), `U+2060–U+206F`, BOM, interlinear annotations, and language tag chars (`U+E0000–U+E007F`).

Escaped chars render as `\xHH` (≤ `0xFF`) or `\u{HHHH}`. Variation selectors and private-use characters are deliberately preserved. `maybe_sanitize` is a zero-copy pass-through when the output is not a terminal, so pipes receive exact names. The same sanitizer protects stderr in `print_error`.

Sanitization keys on `Config.interactive_terminal` (stdout is a TTY), **not** on whether colors are enabled: `--color=always | less -R` is not sanitized.

## Tests

- Unit tests: `src/sanitize.rs` (OSC 52/OSC 8 injection, CR forgery, bidi, preserved Unicode), `src/hyperlink.rs` (percent-encoding), `src/fmt/mod.rs` and `src/fmt/input.rs` (template parsing and path helpers), `src/dir_entry.rs` (dash-prefixed path detection).
- Integration tests: `format`, `test_print0`, `test_custom_path_separator`, `test_hyperlink`, `test_strip_cwd_prefix`, `test_invalid_utf8`, `test_absolute_path`.
