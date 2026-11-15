---
type: concept
title: Output Formatting, Colors and Terminal Safety
description: How fd prints each result. Covers the print_entry modes (--format template, LS_COLORS colorized, plain or raw bytes), color and hyperlink auto-detection, the default LS_COLORS theme, OSC 8 file:// hyperlinks, path separators and trailing slashes, ./ prefix stripping with dash safety, --print0, and how filenames and error messages are sanitized against terminal escape injection.
tags: [output, colors, ls-colors, hyperlinks, sanitization, security, format]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
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
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# Output Formatting, Colors and Terminal Safety

When fd is printing results instead of running a command, the receiver thread calls `output::print_entry(stdout, entry, config)` once per result (see [Parallel Search Pipeline](../architecture/search-pipeline.md)). Stdout is locked and wrapped in a `BufWriter`. Every decision `print_entry` makes comes from fields that `construct_config` set in `src/main.rs`.

## Decision inputs

| Config field | How it is derived |
| --- | --- |
| `interactive_terminal` | `stdout().is_terminal()` |
| `ls_colors` | `Some(...)` only if colored output is on. Taken from the `LS_COLORS` env var, or fd's built-in `DEFAULT_LS_COLORS` theme (a vivid "molokai" 8-bit theme) if `LS_COLORS` is unset |
| colored output | `--color always/never`. In `auto` (the default): ANSI supported **and** `NO_COLOR` unset or empty **and** stdout is a terminal. On Windows, ANSI support means enabling virtual terminal processing succeeds or `TERM` is set |
| `hyperlink` | `--hyperlink[=when]`. Default is `never`. A bare `--hyperlink` means `auto`, and `auto` follows the colored-output decision |
| `format` | `--format <fmt>`, parsed into a `FormatTemplate` |
| `path_separator` / `actual_path_separator` | `--path-separator`. On Windows under MSYS (`MSYSTEM` set) the default is `/`. `actual_path_separator` falls back to the OS separator. On Windows the separator must be a single byte |
| `strip_cwd_prefix` | See below |
| `null_separator` | `-0/--print0` |

## print_entry dispatch

1. If hyperlinks are enabled and the path can be made absolute, print the OSC 8 opener `ESC ]8;; <url> ESC \`.
2. Print the body. The first matching mode wins:
   - **Format template** (`--format`): `FormatTemplate::generate` fills in `{}`, `{/}`, `{//}`, `{.}`, `{/.}` from the stripped path, with path separator substitution. The result is converted with `to_string_lossy` and sanitized. These are the same placeholders `--exec` uses (see [Command Execution](../workflows/command-execution.md)).
   - **Colorized**: the parent directory part, up to and including trailing separators, is painted with the LS_COLORS *directory* style. The final component is painted with the entry's own style, which was precomputed on a worker thread. Directories also get a trailing separator in the directory style.
   - **Uncolorized**: on Unix, when output is **not** a terminal and no custom separator is set, the path's **raw OS bytes** are written directly, so non-UTF-8 filenames reach downstream tools intact. Otherwise the path is converted lossily, the separator is replaced if one was configured, and the result is sanitized. Directories get a trailing separator.
3. Close the hyperlink with `ESC ]8;; ESC \` if one was opened.
4. Terminate with `\0` (`--print0`) or `\n`.

The trailing separator for directories is `actual_path_separator`, so `--path-separator` changes it as well.

### Hyperlinks

`PathUrl` (`src/hyperlink.rs`) builds `file://<host><abs-path>`. On Unix the host is `gethostname()`, cached in a `OnceLock`. On other platforms the host is `/`. Every byte outside `[0-9A-Za-z/:._~-]` is percent-encoded, including all non-ASCII bytes, so escape bytes in a filename can never end up raw inside the OSC 8 sequence. On Windows, `\` becomes `/`. Hyperlinks have no effect in exec modes.

## The `./` prefix and dash safety

Walk results for the implicit search root look like `./foo/bar`. `Opts::strip_cwd_prefix` decides whether to strip that prefix:

- Stripping can only happen when **no explicit search path** was given.
- `--strip-cwd-prefix` (or `=always`) forces stripping. `=never` disables it.
- `auto` (the default) strips **unless** `--print0` or a command (`-x`, `-X`, `-l`) is in use. In those modes the `./` keeps paths that start with `-` from being read as options by the consumer.

Even when stripping is on, `DirEntry::stripped_path` keeps the `./` if removing it would leave a path that starts with `-`. So output like `./-rf` can never turn into `-rf`. This applies to printing, `--format`, and exec arguments.

## Terminal escape sanitization (security)

A malicious filename can contain control sequences: OSC 52 clipboard writes, OSC 8 link spoofing, `\r` overwrites that forge output, Trojan-Source bidi overrides, and so on. `src/sanitize.rs` defends against these:

- `needs_escape(c)` is true for every control character (C0, DEL, C1) except TAB, and for invisible or format characters: soft hyphen, U+180E, U+200B–U+200F, bidi embeddings and overrides U+202A–U+202E, U+2060–U+206F, BOM U+FEFF, interlinear annotations U+FFF9–U+FFFB, and tag characters U+E0000–U+E007F.
- Each such character is rewritten as `\xHH` (code points ≤ 0xFF) or `\u{HHHH}`. The escaping keeps all the information and is never ambiguous with the original. Variation selectors and private-use characters are kept as they are.
- `maybe_sanitize(s, is_terminal)` only sanitizes when the destination is a terminal. Pipes and files receive the bytes unchanged, which is a zero-copy `Cow::Borrowed`.

Sanitization covers the format, colorized, and uncolorized-terminal paths in `output.rs`. It also covers **error messages**: `error::print_error` sanitizes based on whether *stderr* is a terminal and prints `[fd error]: <msg>`. Command output from `--exec` is **not** sanitized, because fd passes it through unchanged.

## Tests

- Unit tests in `src/sanitize.rs` cover the OSC 52, OSC 8, CR forgery, C1 CSI/OSC, bidi, and zero-width cases. `src/hyperlink.rs` tests percent-encoding, and `src/dir_entry.rs` tests dash detection.
- Integration tests: `test_print0`, `test_custom_path_separator`, `test_strip_cwd_prefix`, `test_hyperlink`, `test_invalid_utf8`, and the `test_absolute_path` family in `tests/tests.rs`.
