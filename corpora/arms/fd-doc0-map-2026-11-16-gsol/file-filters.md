---
title: "File Filters"
---
## Overview

Candidate filtering turns a name match into an accepted filesystem entry. The worker checks extensions, file type, Unix ownership, file size, and modification time in that order. Each enabled category must accept the entry. [[Ignore Rules and Traversal]] explains how candidates reach this callback; an accepted entry is sent onward to the output or command consumer. The checks here determine eligibility before either consumer sees the path.

Sources: [src/walk.rs:514-591](repo://src/walk.rs#L514-L591), [src/walk.rs:600-611](repo://src/walk.rs#L600-L611)

## Evaluation order and metadata

Name and extension checks use the path without requesting entry metadata. `DirEntry` stores metadata in `OnceCell<Option<Metadata>>`, caching both successful reads and failure. Normal entries ask the underlying walker entry for metadata; recovered broken symlinks use `symlink_metadata`. Ownership, size, and modification-time filters reject entries when the metadata they need is unavailable. This behavior makes a missing metadata value a failed predicate rather than an automatic match.

Sources: [src/walk.rs:514-535](repo://src/walk.rs#L514-L535), [src/dir_entry.rs:17-22](repo://src/dir_entry.rs#L17-L22), [src/dir_entry.rs:89-96](repo://src/dir_entry.rs#L89-L96), [src/walk.rs:544-591](repo://src/walk.rs#L544-L591)

## Extensions

Repeat `--extension` or `-e` to admit any of several suffixes. Configuration removes leading dots, escapes each extension as literal regex content, appends an end anchor, and builds a case-insensitive regex set. Workers test that set against the filename. Thus extension case is independent of the main pattern's case setting, and the extension requirement is additional to the main name match.

Sources: [src/cli.rs:380-393](repo://src/cli.rs#L380-L393), [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/walk.rs:519-535](repo://src/walk.rs#L519-L535)

The extension option does not imply regular files: a directory whose name ends in the same suffix can pass. Add a type filter when entry kind matters. For names without an extension, the CLI suggests the ordinary regex `^[^.]+$`, rather than a special extension value. These choices keep suffix selection in the name stage and type selection in its own stage.

Sources: [src/cli.rs:380-393](repo://src/cli.rs#L380-L393), [src/walk.rs:526-542](repo://src/walk.rs#L526-L542)

## Type catalogue

| Type selector | Accepted category or added restriction |
| --- | --- |
| `file`, `f` | Regular files |
| `directory`, `dir`, `d` | Directories |
| `symlink`, `l` | Symbolic links |
| `socket`, `s` | Sockets |
| `pipe`, `p` | Named pipes |
| `block-device`, `b` | Block devices |
| `char-device`, `c` | Character devices |
| `executable`, `x` | Enables files and requires the executable check |
| `empty`, `e` | Requires emptiness; enables files and directories if neither was explicitly selected |

Sources: [src/cli.rs:333-378](repo://src/cli.rs#L333-L378), [src/main.rs:333-359](repo://src/main.rs#L333-L359)

Ordinary repeated types form a union: selecting files and symlinks enables both categories. Executable and empty selectors also set restrictions that `FileTypes::should_ignore` applies to the selected entry. The executable restriction calls `faccess::PathExt::executable`; emptiness calls `filesystem::is_empty`. A missing file type or an unrecognized category is rejected whenever type filtering is enabled.

Sources: [src/main.rs:333-359](repo://src/main.rs#L333-L359), [src/filetypes.rs:20-42](repo://src/filetypes.rs#L20-L42)

An empty directory must have a readable directory iterator with no first entry. An empty regular file must have metadata reporting length zero. Other kinds, unreadable directories, and missing type or metadata do not count as empty. Special-kind helpers use native file-type checks on Unix and Redox; their Windows implementations return false for block devices, character devices, sockets, and pipes.

Sources: [src/filesystem.rs:44-100](repo://src/filesystem.rs#L44-L100)

## Unix ownership

The owner predicate carries independent user and group checks. Its parser splits at a single colon, accepts numeric IDs directly, and otherwise resolves names through `nix::unistd::User` or `Group`. More than one colon and unknown names return errors. An omitted or empty side means no constraint for that side; prefixing a side with `!` inverts equality. For example, the source tests cover user-only `5`, group-only `:8`, and mixed `6:!8` constraints.

Sources: [src/filter/owner.rs:24-58](repo://src/filter/owner.rs#L24-L58), [src/filter/owner.rs:76-102](repo://src/filter/owner.rs#L76-L102), [src/filter/owner.rs:125-138](repo://src/filter/owner.rs#L125-L138)

`filter_ignore` removes an owner predicate that constrains neither side. Active predicates require both the UID and GID checks to pass against metadata. Configuration and worker application are compiled under `cfg(unix)`, so this stage is Unix-specific. Ownership is checked before size and time, and an entry lacking metadata is rejected immediately.

Sources: [src/filter/owner.rs:60-73](repo://src/filter/owner.rs#L60-L73), [src/main.rs:266-269](repo://src/main.rs#L266-L269), [src/walk.rs:544-555](repo://src/walk.rs#L544-L555)

## Size constraints

`--size` accepts an integer quantity and unit, optionally preceded by `+` or `-`. `+` means greater than or equal, `-` means less than or equal, and no sign requires exact byte equality after unit multiplication. The parser is case insensitive and requires a unit. Decimal units `k`, `m`, `g`, and `t` use powers of 1,000; binary `ki`, `mi`, `gi`, and `ti` use powers of 1,024. The parser also accepts their optional trailing `b` forms, and `b` alone denotes bytes.

Sources: [src/filter/size.rs:15-74](repo://src/filter/size.rs#L15-L74), [src/cli.rs:395-417](repo://src/cli.rs#L395-L417)

Repeat size constraints to define an intersection such as a minimum and maximum. Workers reject a path unless `entry_path.is_file()` is true, then read its byte length and reject it if any constraint fails. A size-filtered search therefore excludes directories even without `--type file`. Invalid size text is rejected by `SizeFilter::from_string` with a diagnostic pointing to command help.

Sources: [src/walk.rs:557-575](repo://src/walk.rs#L557-L575), [src/filter/size.rs:27-31](repo://src/filter/size.rs#L27-L31)

## Modification-time constraints

`--changed-within` creates an after predicate, and `--changed-before` creates a before predicate. The parser tries a duration span relative to the current zoned time, then an absolute timestamp, then a civil datetime in the system timezone, then unsigned epoch seconds prefixed by `@`. Ambiguous civil times choose the later interpretation. CLI help also accepts date-only input and says its omitted time defaults to midnight.

Sources: [src/main.rs:496-518](repo://src/main.rs#L496-L518), [src/filter/time.rs:12-15](repo://src/filter/time.rs#L12-L15), [src/filter/time.rs:28-55](repo://src/filter/time.rs#L28-L55), [src/cli.rs:419-458](repo://src/cli.rs#L419-L458)

Time comparisons are strict: a value equal to the threshold passes neither before nor after. Both options can constrain one search, in which case all predicates must pass. Invalid date or duration input fails during configuration; a missing or unreadable modification time fails during candidate selection. Unlike size filtering, this worker branch does not restrict entries to regular files. An accepted candidate then reaches [[Result Output]] or [[Command Execution]] with all configured predicates satisfied.

Sources: [src/filter/time.rs:57-62](repo://src/filter/time.rs#L57-L62), [src/main.rs:496-518](repo://src/main.rs#L496-L518), [src/walk.rs:577-611](repo://src/walk.rs#L577-L611), [src/walk.rs:408-440](repo://src/walk.rs#L408-L440)
