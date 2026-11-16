---
type: concept
title: Output, formatting, and path representation
description: How fd renders paths for terminals and pipelines, including sorting limits, byte preservation, sanitization, colors, hyperlinks, and shared format placeholders.
tags: [output, paths, formatting, terminal, security]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:27.513Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-2deefc22f345fd7e2c28832d
    resource: repo://src/fmt/input.rs
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
generated: { by: "codex", at: "2026-11-16T16:28:27.513Z" }
---

# Output, formatting, and path representation

`output::print_entry` is the rendering boundary for ordinary search results. It optionally opens a hyperlink, chooses custom formatting before colored or plain rendering, closes the hyperlink, then writes newline or NUL. Command execution has its own output handling; it reuses path templates but does not send child output through this renderer.

## Ordering and record boundaries

The print receiver buffers initially. A search that ends within the default 100 ms and without exceeding 1,000 held entries sorts those entries by path before output. The deadline or a larger result set switches to streaming, flushing buffered entries in arrival order. `--max-buffer-time` adjusts the deadline; it does not establish a general global sort guarantee. See [pipeline architecture](../architecture/search-pipeline.md) for cancellation and result limits.

`--print0` / `-0` selects NUL record separators. Ordinary directory entries also receive a trailing path separator, unless custom formatting supplies the whole displayed text. NUL separation makes embedded newlines distinguishable in a pipeline, provided downstream tools also accept NUL records.

```bash
fd -t f -0 | xargs -0 printf '%s\n'
fd -t f --format '{/}'
```

## Terminal text versus path bytes

The stdout terminal check controls sanitization independently of color selection. On a terminal, plain, colored, and custom-formatted display text runs through `maybe_sanitize`. It escapes control characters other than tab and a defined set of invisible, bidi, and tag characters. Byte-range values become visible `\xNN` text; larger values become `\u{NNNN}` text. Safe Unicode and tab characters remain unchanged. Escaping filename text prevents embedded terminal control sequences from acting as output instructions.

On Unix, uncolored output to a pipe or file writes the original path bytes directly when no custom separator is configured. Invalid UTF-8 therefore survives that path. Colored output, custom `--format` output, and the custom-separator plain renderer use lossy string conversion, so byte preservation must not be assumed for those modes. Non-Unix plain rendering also uses the string path. Terminal display sanitization is separate from shell argument escaping: child process arguments use OS strings rather than the rendered terminal text.

## Color and hyperlinks

`--color=auto` enables colors only for terminal stdout with ANSI support and without a nonempty `NO_COLOR` value. Explicit `always` and `never` select directly. Windows probes ANSI support, with `TERM` as an additional indication. Colors come from `LS_COLORS` when available, otherwise fd's built-in palette. Parent path text uses the directory indicator style; the final component uses the entry's cached file style. Styles can be precomputed in search workers.

Hyperlinks default to `never`. Explicit `always` enables them; `auto` follows the color decision. For an entry that can be made absolute, `PathUrl` produces a `file://` URL and `print_entry` wraps the display text in OSC 8 delimiters. URL encoding preserves a small ASCII allowlist and percent-encodes other bytes; Windows path backslashes become slashes. Unix hostnames are cached. If absolute path construction fails, that entry is printed without the hyperlink wrapper.

Custom formatting takes precedence over colored path rendering, but hyperlink and record-separator handling still apply. Choosing `-0` alone does not disable explicitly requested colors, hyperlinks, or formatting.

## Relative paths and separators

When no explicit roots are provided, `--strip-cwd-prefix` controls removal of `./`. Its automatic setting removes the prefix for ordinary printed paths and retains it for NUL output or command execution. Explicit roots disable this stripping decision. Even when stripping is requested, `DirEntry` keeps the original prefix if removal would leave a path beginning with `-`, so downstream tools do not mistake that path for an option.

`--absolute-path` normalizes search roots before walking; full-path matching is a separate setting described in [matching and filters](matching-and-filters.md). `filesystem::absolute_path` joins relative paths to the working directory and removes the Windows verbatim prefix for display URLs. It is not a general symlink-resolution step.

`--path-separator` changes output and generated placeholder paths. On Windows, a nonempty `MSYSTEM` sets `/` as the default replacement, and startup rejects separator strings longer than one byte. Plain rendering replaces the platform separator in the displayed string; template expansion rebuilds components, including drive and UNC handling. Literal template text is never rewritten by separator substitution.

## Shared format templates

`fmt::FormatTemplate` parses either fixed text or a token vector using a cached Aho-Corasick matcher. Both `--format` and command arguments use this parser and expand to `OsString`.

For the path `src/main.rs`:

| Placeholder | Meaning | Example expansion |
| --- | --- | --- |
| `{}` | Whole path | `src/main.rs` |
| `{/}` | Basename | `main.rs` |
| `{//}` | Parent | `src` |
| `{.}` | Path without final extension | `src/main` |
| `{/.}` | Basename without final extension | `main` |

`{{` and `}}` escape literal braces. Removing an extension uses `Path::file_stem`, so a compound extension loses its final extension component. Parent expansion returns `.` for a bare filename's empty parent. These transformations do not imply that the generated path exists.

## Verification and extension seams

Keep user-visible text sanitation in rendering; preserve `OsStr`/`OsString` through matching and process arguments where possible. New placeholders require parser tokens, expansion logic, and tests for both format and command consumers. A renderer change should consider terminal status, raw Unix bytes, separator replacement, directory suffixes, and wrappers together.

Useful checks are the `sanitize` unit tests, hyperlink percent-encoding tests, `fmt` template/path tests, and integration cases `format`, `test_invalid_utf8`, `test_custom_path_separator`, `test_strip_cwd_prefix`, and `test_hyperlink`. See [development and testing](../workflows/development-and-testing.md) for harness normalization and [command execution](../workflows/command-execution.md) for subprocess argument and output behavior.
