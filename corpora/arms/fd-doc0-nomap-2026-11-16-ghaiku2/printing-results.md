---
title: "Printing Results"
---
## Overview

`print_entry` writes one entry to the output and ends it with a newline, or with a NUL byte when `-0` (`--print0`) is given. It chooses one of three forms for the path: the `--format` template, a coloured form, or a plain form. The hyperlink wraps whichever form is chosen. The coloured and plain forms end with the trailing separator for directories, and the `--format` form does not.

Sources: [src/output.rs:17-43](repo://src/output.rs#L17-L43)

The choice follows a fixed order. A format template wins over colours, and colours win over the plain form. The colour form is used only when `LS_COLORS` was turned on in `construct_config`, which depends on `--color` and on whether stdout is a terminal.

Sources: [src/output.rs:26-32](repo://src/output.rs#L26-L32), [src/main.rs:288-296](repo://src/main.rs#L288-L296)

## Hyperlinks

With `--hyperlink`, the entry is wrapped in an OSC 8 escape sequence whose target is a `file://` URL for the absolute path. `PathUrl::new` builds the absolute path, and the URL contains the host name, read once from the system, followed by the path with every byte outside a small set of safe characters percent-encoded. Nothing is written when the path cannot be made absolute.

Sources: [src/output.rs:18-24](repo://src/output.rs#L18-L24), [src/hyperlink.rs:1-22](repo://src/hyperlink.rs#L1-L22), [src/hyperlink.rs:24-42](repo://src/hyperlink.rs#L24-L42), [src/hyperlink.rs:44-58](repo://src/hyperlink.rs#L44-L58)

The `auto` setting turns hyperlinks on exactly when colours are on, so a terminal that shows colour also gets links. `--hyperlink=always` turns them on for piped output too, and `never` turns them off.

Sources: [src/main.rs:298-300](repo://src/main.rs#L298-L300), [src/cli.rs:532-549](repo://src/cli.rs#L532-L549)

## Coloured output

`print_entry_colorized` splits the presented path into its directory part and its base name. The directory part, including the separator after it, is painted with the style for directories, and the base name is painted with the entry's own style from `LS_COLORS`. The split happens at the end of the parent path, so a path with no parent is one base name.

Sources: [src/output.rs:89-111](repo://src/output.rs#L89-L111), [src/output.rs:116-129](repo://src/output.rs#L116-L129)

A custom path separator, given with `--path-separator`, replaces the separator in the directory part before the path is painted, so the colour boundaries stay where they were.

Sources: [src/output.rs:112-114](repo://src/output.rs#L112-L114), [src/output.rs:12-14](repo://src/output.rs#L12-L14)

The trailing separator that marks a directory is printed in the directory style, with the path separator the user chose. It is not coloured by the entry's style, so a directory's name and its slash can carry different colours.

Sources: [src/output.rs:45-66](repo://src/output.rs#L45-L66), [src/output.rs:131-136](repo://src/output.rs#L131-L136)

## Plain output

The plain form writes the presented path and the trailing separator. On Unix, when the output is piped and no custom separator is set, the raw bytes of the path are written, so a file name that is not valid UTF-8 reaches the downstream program unchanged. On a terminal, or with a custom separator, the path is converted to text and passed through the sanitiser.

Sources: [src/output.rs:142-156](repo://src/output.rs#L142-L156), [src/output.rs:167-182](repo://src/output.rs#L167-L182)

## Terminal sanitising

`maybe_sanitize` runs the escaping only when the output is a terminal. Piped output keeps the raw bytes so that tools receive exactly the names on disk.

Sources: [src/sanitize.rs:47-55](repo://src/sanitize.rs#L47-L55)

When escaping runs, each character that `needs_escape` flags is replaced by a visible escape. Tab is the one control character that is kept. Characters up to `0xFF` become `\xNN`, and higher ones become `\u{NNNN}`. The flagged set covers C0 and C1 controls, DEL, soft hyphen, zero-width and bidi-control characters, word joiners, and the language-tag block, so a name cannot hide text or move the cursor.

Sources: [src/sanitize.rs:6-26](repo://src/sanitize.rs#L6-L26), [src/sanitize.rs:28-45](repo://src/sanitize.rs#L28-L45)

## Format output

With `--format`, the template is expanded from the presented path, with the custom path separator applied, and the result is passed through `maybe_sanitize` like the other forms, so it is escaped only on a terminal. The template is parsed once, in `construct_config`. The expansion rules are described in [[Exec Templates]].

Sources: [src/output.rs:69-86](repo://src/output.rs#L69-L86), [src/main.rs:374-376](repo://src/main.rs#L374-L376)
