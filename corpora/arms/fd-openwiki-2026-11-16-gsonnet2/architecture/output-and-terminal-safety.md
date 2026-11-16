---
type: architecture
title: Output Formatting and Terminal Safety
description: How fd renders each result - LS_COLORS styling, --format templates, null separators, OSC 8 hyperlinks, custom path separators, raw-byte output on pipes - and how filenames are sanitized to prevent terminal escape injection.
tags: [output, terminal, security, sanitization, colors, hyperlinks]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
sources:
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-95f84abff7e2ed283d50b3fb
    resource: repo://src/error.rs
  - id: openwiki-source-bdffa7be827daa0dba122070
    resource: repo://src/hyperlink.rs
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# Output Formatting and Terminal Safety

Printing is owned by `src/output.rs::print_entry`, called from the receiver thread's `ReceiverBuffer::print` (see [[architecture/parallel-walk-pipeline]]). It is only used when no `--exec` command is configured (see [[architecture/command-execution]]).

## Rendering pipeline

`print_entry(stdout, entry, config)` writes, in order:

1. **Optional hyperlink opener.** If `config.hyperlink` is set and `PathUrl::new` succeeds, it emits the OSC 8 sequence `ESC ] 8 ; ; file://HOST/ABS_PATH ESC \`.
2. **The entry body**, chosen by precedence: `--format` template, else colorized (when `config.ls_colors` is `Some`), else uncolorized.
3. **Hyperlink closer**, if one was opened.
4. **Terminator**: `\0` with `--print0`, otherwise a newline.

### `--format`

`print_entry_format` runs the parsed `FormatTemplate` (the same placeholder engine used by `--exec`) on `entry.stripped_path(config)` and writes the result lossily as UTF-8, after sanitization.

### Colorized output

`print_entry_colorized` splits the path into the parent portion (including the trailing separator) and the basename. The parent is painted with the LS_COLORS *directory* indicator style; the basename uses the per-entry style computed by `DirEntry::style`, cached in a `OnceCell` and computed on the sender threads when the walk runs in parallel (see [[architecture/parallel-walk-pipeline]]). Directories receive a trailing path separator (`config.actual_path_separator`), painted in the directory style, but never colored as part of the name. Uncolorized output adds the same trailing separator.

### Custom path separator

With `--path-separator`, `replace_path_separator` rewrites `std::path::MAIN_SEPARATOR` in the printed path; on Windows under MSYS/MSYS2 the default becomes `/` (`filesystem::default_path_separator`).

### Raw bytes on pipes (Unix)

For uncolorized output on Unix, if stdout is **not** an interactive terminal and no custom separator is set, `print_entry_uncolorized` writes the path's raw `OsStr` bytes. Non-UTF-8 file names therefore reach downstream tools intact. On a terminal (or with a custom separator) the lossy-string path is used and sanitization applies.

## Path presentation: the `./` prefix and dash guard

`DirEntry::stripped_path` removes a leading `./` when `config.strip_cwd_prefix` is true (see [[architecture/cli-and-config]]). If stripping would leave a path whose first byte is `-`, the original `./`-prefixed path is kept, so downstream tools never mistake a filename for an option. `into_stripped_path` is the owning variant used for batch execution.

`DirEntry` has two variants: a normal `ignore::DirEntry`, and a `BrokenSymlink(PathBuf)` constructed by the walker for dangling symlinks. Metadata is lazily loaded (`symlink_metadata` for broken links) and cached. Entries order by path, which the receiver relies on when it sorts the initial buffer.

## Terminal escape sanitization (`src/sanitize.rs`)

File names are attacker-controlled text. `sanitize_for_terminal` escapes every char that `needs_escape`: all control characters (C0, DEL, C1 including 8-bit CSI/OSC introducers) except horizontal tab, plus invisible/format characters (soft hyphen, Mongolian vowel separator, zero-width and LRM/RLM, bidi embedding/override, word joiner and deprecated formats, BOM, interlinear annotation, and language tag characters). Escapes are rendered as `\xNN` (≤ 0xFF) or `\u{NNNN}`, which preserves information while neutralizing clipboard-write (OSC 52), forged-output (CR), hyperlink-injection (OSC 8) and Trojan-Source bidi attacks. Variation selectors and private-use characters are deliberately kept, since they are legitimate in emoji, CJK and icon-font names.

`maybe_sanitize(s, is_terminal)` applies this only when `config.interactive_terminal` is true; for pipes and files strings are borrowed unchanged (zero-copy). Tests in `src/sanitize.rs` cover each attack class and the preserved Unicode.

## Error messages

`print_error` (`src/error.rs`) prints `[fd error]: <msg>` to stderr and sanitizes the message when stderr is a terminal, because error text can embed file names or patterns.

## Hyperlinks (`src/hyperlink.rs`)

`PathUrl` builds `file://<host>/<absolute path>` URLs: the hostname comes from `nix::unistd::gethostname` on Unix (cached in a `OnceLock`), and is `/` on non-Unix targets. Every byte outside `[0-9A-Za-z/:._~-]` is percent-encoded (non-ASCII bytes included, since Windows paths may not be valid UTF-8); on Windows `\` becomes `/`. Absolute paths are computed via `filesystem::absolute_path`, which strips the `\\?\` prefix on Windows. Hyperlinks default to on when colored output is on (see [[architecture/cli-and-config]]).
