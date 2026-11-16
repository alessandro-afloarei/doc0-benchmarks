---
title: "File Filters"
---
## Overview

File filters narrow entries that have already passed the depth and name checks. The callback applies extension, type, owner, size, and modification-time checks in that order, returning early on failure. [[Search Patterns and Paths]] owns the name predicate, and [[Directory Traversal and Ignore Rules]] explains why rejecting an entry usually permits traversal to continue into its descendants.

Sources: [src/walk.rs:508-591](repo://src/walk.rs#L508-L591)

## Combining constraints

| Filter | Combination rule | Data examined |
| --- | --- | --- |
| Extension | Any configured extension may match | Final filename |
| Ordinary types | Selected categories are included | Entry file type |
| Executable and empty | Additional restrictions on selected categories | Access check or emptiness |
| Owner | User and group requirements must both pass | UID and GID |
| Size | Every supplied constraint must pass | File length |
| Modification time | Every configured boundary must pass | Modification timestamp |

Sources: [src/walk.rs:526-591](repo://src/walk.rs#L526-L591), [src/filetypes.rs:21-41](repo://src/filetypes.rs#L21-L41), [src/filter/owner.rs:69-82](repo://src/filter/owner.rs#L69-L82)

Filters from different rows are cumulative. Selecting an extension does not automatically restrict results to regular files, and a type filter does not replace a name expression. The callback deliberately checks names before metadata-dependent constraints because names do not require metadata. Thus the same filter settings affect both printed paths and the entries delivered to command execution.

Sources: [src/cli.rs:380-393](repo://src/cli.rs#L380-L393), [src/walk.rs:514-591](repo://src/walk.rs#L514-L591), [src/walk.rs:593-611](repo://src/walk.rs#L593-L611), [src/walk.rs:408-438](repo://src/walk.rs#L408-L438)

## Extension matching

`construct_config` strips leading dots from extension arguments, escapes their regex syntax, and builds a case-insensitive regex set. Each expression requires a character before a literal dot, followed by the requested extension at the end of the filename. Multiple extensions become alternatives in the set. The callback tests the final filename regardless of whether the main expression uses full-path matching.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/walk.rs:517-535](repo://src/walk.rs#L517-L535)

The CLI explicitly permits extension matches on directories and other entry types. Add `--type file` when only regular files should qualify. To find names without an extension, the CLI suggests using `^[^.]+$` as the ordinary search expression; this follows the regex path described in [[Search Patterns and Paths]] rather than introducing an empty-extension special case.

Sources: [src/cli.rs:380-393](repo://src/cli.rs#L380-L393), [src/main.rs:218-231](repo://src/main.rs#L218-L231)

## Types, executable entries, and emptiness

The ordinary categories are file, directory, symlink, block device, character device, socket, and pipe. Configuration accumulates the selected categories, so selecting both file and symlink admits either. `FileTypes::should_ignore` rejects unselected categories, unknown types, and entries with no available file type. The special-device helpers return false on Windows for block devices, character devices, sockets, and pipes.

Sources: [src/main.rs:333-350](repo://src/main.rs#L333-L350), [src/filetypes.rs:21-41](repo://src/filetypes.rs#L21-L41), [src/filesystem.rs:62-99](repo://src/filesystem.rs#L62-L99)

Executable selection turns on the regular-file category and an additional `executables_only` flag. The predicate calls `entry.path().executable()` through `faccess`; executable status is therefore a separate check, not a filename-extension convention. Empty selection turns on `empty_only`. When no file or directory category was selected alongside it, configuration adds both, so the default empty search covers empty files and directories.

Sources: [src/main.rs:337-359](repo://src/main.rs#L337-L359), [src/filetypes.rs:4-4](repo://src/filetypes.rs#L4-L4), [src/filetypes.rs:21-41](repo://src/filetypes.rs#L21-L41)

For a directory, emptiness means `read_dir` successfully opens it and yields no first entry. This check sees directory contents directly rather than the search's ignored-result set. For a regular file, emptiness means cached metadata reports length zero. Other types, unavailable metadata, and a failed directory open do not satisfy the empty predicate.

Sources: [src/filesystem.rs:44-59](repo://src/filesystem.rs#L44-L59)

## File size

`--size` accepts an optional sign, an integer quantity, and a required unit. A plus sign means greater than or equal to the boundary; a minus means less than or equal; no sign means exact equality. Units are case-insensitive. Decimal `k`, `m`, `g`, and `t` use powers of 1,000, while `ki`, `mi`, `gi`, and `ti` use powers of 1,024. Those prefixed units can end in `b`, and plain `b` selects bytes.

Sources: [src/filter/size.rs:15-74](repo://src/filter/size.rs#L15-L74), [src/cli.rs:395-417](repo://src/cli.rs#L395-L417)

The parser rejects missing units and noninteger quantities. At traversal time, any size constraint first requires `entry_path.is_file()`, then available metadata. The callback tests every constraint against the same byte length and rejects the entry if any one fails. Multiple constraints can therefore form an inclusive range, and directories cannot satisfy a size-constrained search.

Sources: [src/filter/size.rs:28-65](repo://src/filter/size.rs#L28-L65), [src/walk.rs:557-575](repo://src/walk.rs#L557-L575)

## Modification time

`--changed-within` creates an `After` boundary and `--changed-before` creates a `Before` boundary. `TimeFilter` first tries a `jiff::Span`, subtracting it from the current zoned time. It then tries an absolute timestamp, a local civil datetime resolved through the system timezone with the later ambiguity choice, and finally unsigned epoch seconds prefixed with `@`. An invalid date or duration fails configuration before scanning.

Sources: [src/filter/time.rs:12-15](repo://src/filter/time.rs#L12-L15), [src/filter/time.rs:28-55](repo://src/filter/time.rs#L28-L55), [src/main.rs:496-518](repo://src/main.rs#L496-L518)

Time boundaries are strict: before uses less-than and after uses greater-than, unlike inclusive size bounds. The callback requires available metadata and a successful `modified()` call, then requires every time predicate to pass. It does not impose the size filter's regular-file check, so modification-time filtering can apply to other entries with usable metadata.

Sources: [src/filter/time.rs:57-62](repo://src/filter/time.rs#L57-L62), [src/walk.rs:577-591](repo://src/walk.rs#L577-L591)

## User and group ownership

On Unix, `--owner` accepts an optional user or UID and an optional group or GID separated by one colon. Each side can start with `!` to require inequality. Numeric values are parsed directly; names are resolved through the user or group database and unknown names fail. More than one colon is invalid. Missing sides impose no requirement, and an entirely empty constraint or `:` is removed as a no-op.

Sources: [src/cli.rs:460-473](repo://src/cli.rs#L460-L473), [src/filter/owner.rs:24-67](repo://src/filter/owner.rs#L24-L67), [src/filter/owner.rs:85-102](repo://src/filter/owner.rs#L85-L102), [src/main.rs:268-269](repo://src/main.rs#L268-L269)

The UID and GID checks must both pass. An active ownership filter requires metadata; failure to retrieve it rejects the entry. This behavior applies only where the Unix-specific option and callback branch are compiled.

Sources: [src/filter/owner.rs:69-82](repo://src/filter/owner.rs#L69-L82), [src/walk.rs:544-555](repo://src/walk.rs#L544-L555), [src/cli.rs:468-473](repo://src/cli.rs#L468-L473)

## Metadata lifetime

`DirEntry` caches metadata in a `OnceCell<Option<Metadata>>`. A normal entry delegates to the underlying walker entry, while the recovered broken-link representation uses `symlink_metadata`. Both success and failure are cached, so later predicates reuse the same result rather than retrying metadata lookup. Once an entry passes all constraints, [[Output and Formatting]] may reuse it for styling and presentation.

Sources: [src/dir_entry.rs:17-22](repo://src/dir_entry.rs#L17-L22), [src/dir_entry.rs:82-109](repo://src/dir_entry.rs#L82-L109), [src/dir_entry.rs:139-166](repo://src/dir_entry.rs#L139-L166), [src/walk.rs:593-600](repo://src/walk.rs#L593-L600)
