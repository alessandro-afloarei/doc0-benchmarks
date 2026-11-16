---
type: feature
title: Output, Colors, Formatting, and Hyperlinks
description: How fd prints each result — ./ prefix stripping, custom path separators, trailing directory separators, LS_COLORS-based coloring, --format templates, --print0, OSC 8 hyperlinks, raw-byte output for pipes, and sanitization of terminal escape sequences in file names and error messages.
tags: [output, colors, ls-colors, format, hyperlink, sanitize, security]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-82ad9015e8518df8ee697487
    resource: repo://src/fmt/mod.rs
  - id: openwiki-source-bdffa7be827daa0dba122070
    resource: repo://src/hyperlink.rs
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# Output, Colors, Formatting, and Hyperlinks

When no command is configured, the walker's `ReceiverBuffer` calls `output::print_entry(stdout, entry, config)` for every result (see [Parallel Walk and Receiver](../architecture/parallel-walk-and-receiver.md)). Stdout is a locked `BufWriter`, flushed when the receiver goes idle or finishes. The relevant `Config` fields are all resolved up front in `construct_config` ([CLI Parsing and Configuration](../architecture/cli-and-configuration.md)).

## `print_entry` structure

```text
[OSC 8 hyperlink start]  (if config.hyperlink)
  one of:
    --format template      → print_entry_format
    colors enabled         → print_entry_colorized
    otherwise              → print_entry_uncolorized
[OSC 8 hyperlink end]
"\0" if --print0, else "\n"
```

## Paths

All printers start from `DirEntry::stripped_path(config)`:

- **`./` prefix stripping** is on only when no explicit search path was given. In the default `auto` mode it is disabled when `--print0` or a command (`--exec`, `--exec-batch`, `--list-details`) is used, because those consumers often benefit from an explicit `./`. `--strip-cwd-prefix[=always|never|auto]` overrides it.
- If stripping would produce a path starting with `-`, the `./` is kept so the result can't be parsed as an option by downstream tools.
- **`--absolute-path`/`-a`** makes the search roots absolute (in `Opts::normalize_path`), so all results inherit absolute paths.
- **`--path-separator <sep>`** replaces `std::path::MAIN_SEPARATOR` in printed paths. On Windows under MSYS (`MSYSTEM` set) the default becomes `/`.
- **Directories get a trailing separator** (`config.actual_path_separator`) in the colorized and uncolorized printers. In color mode the trailing separator uses the directory style. `--format` output does not add one.

## Colors

Colors are enabled by `--color always`, or by `auto` when stdout is a terminal, ANSI is supported, and `NO_COLOR` is unset/empty. The styles come from `LS_COLORS` via the `lscolors` crate, or from fd's built-in `DEFAULT_LS_COLORS` (a vivid "molokai" theme in `src/main.rs`) if `LS_COLORS` is not set.

`print_entry_colorized` splits the path into parent and file name. The parent part (including trailing separators) is painted with the `Directory` indicator style; the file name is painted with the entry's own style. The entry style is computed on the walker threads and cached in `DirEntry` (`OnceCell`), so the single printing thread does little work per result.

## `--format` templates

`--format <fmt>` (conflicts with `--list-details`) is parsed once into a `FormatTemplate` (`src/fmt/mod.rs`) using the same placeholders as `--exec`: `{}`, `{/}`, `{//}`, `{.}`, `{/.}`, and `{{`/`}}` escapes. `FormatTemplate::generate` expands placeholders for each path, applying `--path-separator` only to placeholder expansions. The result is converted lossily to UTF-8 and printed (sanitized for terminals). Details of the template language are in [Command Execution](command-execution.md#templates-and-placeholders).

## Hyperlinks

`--hyperlink[=auto|always|never]` (default `never`; bare `--hyperlink` means `auto`, which follows the color decision) wraps each result in an OSC 8 escape sequence: `ESC ]8;; file://<host><abs-path> ESC \` … `ESC ]8;; ESC \`.

`PathUrl` (`src/hyperlink.rs`) builds the URL from the absolute path. The host is the machine's hostname on Unix (looked up once via `nix::unistd::gethostname`) and empty on other platforms (the URL becomes `file:///...`). Every byte other than ASCII alphanumerics and `/ : - . _ ~` is percent-encoded, including all non-ASCII bytes; on Windows `\` is converted to `/`. Hyperlinks are not applied to `--exec` output.

## Null separators

`--print0`/`-0` writes `\0` instead of `\n` after each result (conflicts with `--list-details`), and disables automatic `./` stripping.

## Raw bytes vs. lossy UTF-8

On Unix, the uncolorized printer writes the **raw bytes** of the path when stdout is not a terminal and no custom path separator is set, so file names with invalid UTF-8 reach tools like `xargs` intact. In all other cases (terminal output, colors, custom separator, `--format`, non-Unix) the path is converted with `to_string_lossy`.

## Terminal escape sanitization (`src/sanitize.rs`)

File names can contain control characters that would let a malicious file name inject terminal escape sequences (e.g. OSC 52 clipboard writes, OSC 8 fake links, carriage-return output forgery). `maybe_sanitize(s, is_terminal)` protects against this:

- It is applied **only when writing to a terminal** (`config.interactive_terminal` for stdout); pipes and files receive the original text.
- `needs_escape` flags every Unicode control character except tab, plus invisible/format characters: soft hyphen, Mongolian vowel separator, zero-width characters and LRM/RLM, bidi embeddings/overrides, word joiner and other invisibles (U+2060–206F), BOM, interlinear annotation characters, and language tag characters.
- Flagged characters are replaced with visible escapes: `\xNN` for code points ≤ 0xFF, `\u{NNNN}` otherwise. Strings that need no escaping are borrowed without allocation.

Sanitization is applied to the parent and file-name parts in the colorized printer, to the whole path in the uncolorized printer, and to `--format` output. `error::print_error` applies the same function to messages on stderr when stderr is a terminal, so file names in error messages are also safe. Note that when colors are forced with `--color=always` into a pipe, `interactive_terminal` is false and names are not sanitized.

## Performance notes

`print_entry` and its helpers are marked performance-critical in comments. Common fast paths: borrowed `Cow`s when no separator replacement or escaping is needed, cached styles, and a single buffered, locked stdout.

## Tests

- Unit tests: `src/sanitize.rs` (attack strings such as OSC 52, OSC 8, CR, DEL, bidi), `src/hyperlink.rs` (percent encoding), `src/fmt/` (template parsing and path helpers).
- Integration tests in `tests/tests.rs`: `test_print0`, `test_custom_path_separator`, `test_strip_cwd_prefix`, `test_hyperlink`, `--format` cases, and absolute-path tests. See [Testing](../testing/integration-tests.md).
