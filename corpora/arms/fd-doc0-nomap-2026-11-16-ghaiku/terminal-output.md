---
title: "Terminal Output"
---
## Overview

`print_entry` writes one result line. It chooses one of three renderings from the `Config` (a `--format` template, coloured output, or plain output), wraps the line in a terminal hyperlink when that is enabled, and ends it with a newline or, under `--print0`, a NUL byte. The renderings differ in what they keep raw and what they escape, so this page follows each branch. The receiver calls it for every entry it prints, as described in [[Result Streaming]].

Sources: [src/output.rs:17-47](repo://src/output.rs#L17-L47)

## Hyperlinks

When hyperlinks are on, `print_entry` writes an OSC 8 escape before the line with a `file://` URL for the entry, and an empty OSC 8 after it. The URL comes from `PathUrl::new`, which makes the path absolute first; if that fails, no link is written. Every byte except ASCII letters, digits and a few punctuation characters is percent-encoded. The host part is the machine's hostname on Unix, and empty on other platforms, where the URL starts with `file:///`.

Sources: [src/output.rs:17-27](repo://src/output.rs#L17-L27), [src/output.rs:40-45](repo://src/output.rs#L40-L45), [src/hyperlink.rs:7-40](repo://src/hyperlink.rs#L7-L40), [src/hyperlink.rs:44-62](repo://src/hyperlink.rs#L44-L62)

## Coloured output

With colours on, `print_entry_colorized` paints the path in two pieces. The leading directory part, up to and including the separators after the parent, is painted with the style for the directory indicator. The basename is painted with the style `LsColors` gives this entry, which the sender computed earlier when `ls_colors` was set. A trailing separator is added and painted for a directory.

Sources: [src/output.rs:89-140](repo://src/output.rs#L89-L140), [src/output.rs:49-67](repo://src/output.rs#L49-L67), [src/walk.rs:593-598](repo://src/walk.rs#L593-L598)

The parent and basename are each passed through `maybe_sanitize` before painting. On a terminal, a control character in a file name is therefore shown as an escape rather than acted on by the terminal.

Sources: [src/output.rs:113-131](repo://src/output.rs#L113-L131)

## Plain output

Without colours, `print_entry_uncolorized_base` converts the path to text, replaces the separator when `--path-separator` is set, sanitises it and writes it, followed by a trailing separator for directories. Windows always uses this path; on Unix it is used for terminal output and whenever `--path-separator` is given.

Sources: [src/output.rs:142-157](repo://src/output.rs#L142-L157)

On Unix, piped output takes a different branch. When stdout is not a terminal and no path separator is given, the raw bytes of the path are written, so file names that are not valid UTF-8 reach a downstream tool unchanged.

Sources: [src/output.rs:168-182](repo://src/output.rs#L168-L182)

## Format templates

With `--format`, the path is given to `FormatTemplate::generate`, and the result is converted with `to_string_lossy` and sanitised. The template language is described in [[Format Templates]]. A template line does not get colour, because the template chooses the text.

Sources: [src/output.rs:69-87](repo://src/output.rs#L69-L87)

## Sanitising control characters

`maybe_sanitize` escapes text only when the destination is a terminal. `sanitize_for_terminal` replaces control characters, DEL, bidi overrides, zero-width and invisible format characters with `\xHH` (for code points up to U+00FF) or `\u{HHHH}`. Tab is kept, and everything else passes unchanged, so non-ASCII letters remain readable. Pipes and files receive the raw text.

Sources: [src/sanitize.rs:9-47](repo://src/sanitize.rs#L9-L47), [src/sanitize.rs:49-55](repo://src/sanitize.rs#L49-L55)

The same function protects error messages. `print_error` sanitises against whether stderr is a terminal, so when stderr is one, an error that quotes a file name cannot rewrite the screen.

Sources: [src/error.rs:1-9](repo://src/error.rs#L1-L9)
