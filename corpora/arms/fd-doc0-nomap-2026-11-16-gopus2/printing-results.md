---
title: "Printing Results"
---
## Overview

When no command is given, the receiver ([[Result Receiver]]) calls `output::print_entry` once per result, with a buffered, locked stdout. `print_entry` writes one line: an optional hyperlink wrapper, the path in one of three styles (a `--format` template, colored, or plain), and a newline or a NUL byte.

Sources: [src/output.rs:16-43](repo://src/output.rs#L16-L43), [src/walk.rs:251-258](repo://src/walk.rs#L251-L258)

Printing reads only `Config`: the color table, the separators and the terminal flag were decided by `construct_config` ([[Command-Line Parsing and Configuration]]). Each entry's color style is usually computed in advance on a walker thread and cached in the `DirEntry` ([[Parallel Directory Walk]]), so the single printing thread does little work per line.

Sources: [src/walk.rs:593-598](repo://src/walk.rs#L593-L598), [src/dir_entry.rs:105-110](repo://src/dir_entry.rs#L105-L110)

## print_entry

`print_entry` picks the style in a fixed order: `--format` wins over color, and color over plain output. `--format` conflicts with `--list-details`, and the hyperlink and terminator are added around whichever style ran.

Sources: [src/output.rs:16-43](repo://src/output.rs#L16-L43), [src/cli.rs:475-487](repo://src/cli.rs#L475-L487)

```mermaid
flowchart TD
  start["print_entry"] --> link{"config.hyperlink and<br>PathUrl::new ok?"}
  link -->|yes| open["write OSC 8 open"]
  link -->|no| style
  open --> style{"style"}
  style -->|"config.format"| fmt["print_entry_format"]
  style -->|"config.ls_colors"| color["print_entry_colorized"]
  style -->|otherwise| plain["print_entry_uncolorized"]
  fmt --> close{"hyperlink opened?"}
  color --> close
  plain --> close
  close -->|yes| closeLink["write OSC 8 close"]
  close -->|no| term
  closeLink --> term{"null_separator?"}
  term -->|yes| nul["write \\0"]
  term -->|no| nl["writeln"]
```

Sources: [src/output.rs:16-43](repo://src/output.rs#L16-L43)

## The displayed path

Every style starts from `DirEntry::stripped_path`. When `strip_cwd_prefix` is on, it removes a leading `./` from the path, unless the result would start with `-`: in that case the `./` is kept so that downstream tools do not read the path as an option. `into_stripped_path` is the owned version used by `--exec-batch`.

Sources: [src/dir_entry.rs:56-80](repo://src/dir_entry.rs#L56-L80), [src/dir_entry.rs:112-114](repo://src/dir_entry.rs#L112-L114)

`strip_cwd_prefix` is decided in `Opts::strip_cwd_prefix`: it is only ever on when no search path was given, so that paths under an explicit root are printed as the user wrote them. `--strip-cwd-prefix=always` and `never` force it; in the default `auto` mode it is on unless `--print0` or a command is used.

Sources: [src/cli.rs:674-680](repo://src/cli.rs#L674-L680), [src/cli.rs:765-773](repo://src/cli.rs#L765-L773), [src/main.rs:390-390](repo://src/main.rs#L390-L390)

## Output styles

### Format templates

`print_entry_format` expands the `FormatTemplate` parsed from `--format` with the stripped path and the custom path separator, converts the result to a string lossily, and sanitizes it for the terminal. The placeholders are those of `--exec` and are described on [[Placeholder Templates]]. No trailing separator is added for directories in this style.

Sources: [src/output.rs:68-86](repo://src/output.rs#L68-L86)

### Colored output

`print_entry_colorized` splits the path into the parent part and the file name. The offset is the length of the parent's string plus any separators that follow it. The parent part is painted with the `LS_COLORS` directory style, after replacing the separator when `--path-separator` is set; the file name is painted with the entry's own style from `DirEntry::style`. Both parts are sanitized before painting.

Sources: [src/output.rs:88-139](repo://src/output.rs#L88-L139)

The color table is `LsColors::from_env()`, read from the `LS_COLORS` variable, or the built-in `DEFAULT_LS_COLORS` string when that variable is unset. The built-in table was generated with `vivid --color-mode 8-bit generate molokai`.

Sources: [src/main.rs:56-60](repo://src/main.rs#L56-L60), [src/main.rs:288-292](repo://src/main.rs#L288-L292)

### Plain output

`print_entry_uncolorized_base` converts the path to a string lossily, replaces the separator if one was given, sanitizes it and writes it. On Unix, `print_entry_uncolorized` uses it only when stdout is a terminal or a custom separator is set. When output goes to a pipe or a file, it writes the path's raw bytes instead, so file names that are not valid UTF-8 reach downstream tools intact. Other platforms always use the string path.

Sources: [src/output.rs:141-182](repo://src/output.rs#L141-L182)

### Directory suffix

The colored and plain styles end with `print_trailing_slash`: when the entry is a directory, it writes `actual_path_separator` (the custom separator, or the platform's), painted with the directory style in colored output. A directory is printed as `src/`, which tells it apart from a file without a `-l` listing.

Sources: [src/output.rs:45-66](repo://src/output.rs#L45-L66), [src/output.rs:131-137](repo://src/output.rs#L131-L137), [src/output.rs:155-155](repo://src/output.rs#L155-L155)

## Path separators

`replace_path_separator` replaces every occurrence of the platform's `MAIN_SEPARATOR` with the custom one. It is applied to the parent part in colored output and to the whole path in plain output; format templates replace separators through `FormatTemplate::generate`.

Sources: [src/output.rs:12-14](repo://src/output.rs#L12-L14), [src/output.rs:111-114](repo://src/output.rs#L111-L114), [src/output.rs:149-152](repo://src/output.rs#L149-L152)

## Hyperlinks

With `--hyperlink` (or `--hyperlink=auto` when output is colored), each path is wrapped in an OSC 8 escape: `ESC ] 8 ; ; url ESC \` before it and `ESC ] 8 ; ; ESC \` after it. `PathUrl::new` makes the path absolute; if that fails, the path is printed without a link.

Sources: [src/output.rs:17-35](repo://src/output.rs#L17-L35), [src/hyperlink.rs:1-11](repo://src/hyperlink.rs#L1-L11), [src/cli.rs:532-548](repo://src/cli.rs#L532-L548)

`PathUrl` displays as `file://` followed by the host name and the percent-encoded path. On Unix the host name comes from `gethostname` once and is cached in a `OnceLock`; elsewhere the host is `/`. ASCII letters, digits and `/ : - . _ ~` pass through, a Windows `\` becomes `/`, and every other byte, including all non-ASCII bytes, is percent-encoded, because on some systems the path bytes may not be valid UTF-8.

Sources: [src/hyperlink.rs:13-62](repo://src/hyperlink.rs#L13-L62)

## Terminal sanitization

A file name can contain bytes that a terminal interprets: an escape sequence could set the clipboard (OSC 52), forge a hyperlink, or move the cursor to overwrite earlier output. `sanitize.rs` exists "to prevent terminal escape injection via filenames".

Sources: [src/sanitize.rs:1-1](repo://src/sanitize.rs#L1-L1), [src/sanitize.rs:79-96](repo://src/sanitize.rs#L79-L96)

`needs_escape` flags every control character except tab, plus the soft hyphen, the Mongolian vowel separator, zero-width characters and LRM/RLM, bidi embeddings and overrides, invisible format characters, the BOM, interlinear annotations and language tags. `sanitize_for_terminal` borrows the string unchanged when nothing needs escaping, and otherwise writes flagged characters as `\xHH` (up to U+00FF) or `\u{HHHH}`, so the escaped name still shows which character was there.

Sources: [src/sanitize.rs:6-46](repo://src/sanitize.rs#L6-L46)

`maybe_sanitize` applies it only when the output is a terminal (`config.interactive_terminal` for stdout, `stderr().is_terminal()` for error messages). Piped output is never altered. Legitimate Unicode such as variation selectors and private-use icon-font characters is left alone.

Sources: [src/sanitize.rs:48-55](repo://src/sanitize.rs#L48-L55), [src/sanitize.rs:141-167](repo://src/sanitize.rs#L141-L167), [src/error.rs:5-9](repo://src/error.rs#L5-L9)
