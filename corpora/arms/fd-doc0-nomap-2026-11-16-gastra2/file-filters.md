---
title: "File Filters"
---
## Overview

File filters refine entries that have already passed discovery and name matching. [[Traversal and Ignore Rules]] determines whether an entry is visited, and [[Search Patterns]] explains the initial text predicate. The worker then checks extensions, types, Unix ownership, file size and modification time in that order. A failed check immediately rejects the entry; passing one filter never overrides a failure in another.

Sources: [src/walk.rs:514-591](repo://src/walk.rs#L514-L591)

## Choosing and combining filters

| Filter | Option | Combination rule |
| --- | --- | --- |
| Extension | `--extension`, `-e` | Match any supplied extension |
| Entry type | `--type`, `-t` | Include selected basic types; executable and empty flags add restrictions |
| Size | `--size`, `-S` | Satisfy every supplied size constraint |
| Modification time | `--changed-within`, `--changed-before` | Satisfy every configured time boundary |
| Owner | `--owner`, `-o`, Unix only | Satisfy both configured user and group checks |

Sources: [src/cli.rs:367-417](repo://src/cli.rs#L367-L417), [src/cli.rs:419-470](repo://src/cli.rs#L419-L470), [src/main.rs:333-373](repo://src/main.rs#L333-L373), [src/walk.rs:526-591](repo://src/walk.rs#L526-L591), [src/filter/owner.rs:69-73](repo://src/filter/owner.rs#L69-L73)

## Extension matching

Extension configuration removes leading dots from each supplied value, escapes regex metacharacters and builds a case-insensitive regex set. Each expression requires a character before the extension dot and anchors the extension at the end of the basename. Repeated extensions are alternatives in that set, independently of the case setting used by the main search pattern.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/walk.rs:526-535](repo://src/walk.rs#L526-L535)

The extension predicate uses the entry's filename, even when the main pattern uses full-path matching. It does not require a regular file: a directory with a matching suffix can pass. Add a type restriction to distinguish those cases. For extensionless names, the CLI documents `^[^.]+$` as a normal search pattern rather than a special extension value.

Sources: [src/walk.rs:517-542](repo://src/walk.rs#L517-L542), [src/cli.rs:380-393](repo://src/cli.rs#L380-L393)

## Entry types and refinements

Basic types are regular file, directory, symlink, socket, named pipe, block device and character device. Repeating `--type` enables several categories. `FileTypes::should_ignore` rejects entries whose known category is disabled, entries with no available type and types outside the recognized set. Device, socket and pipe classification uses Unix-style extensions on Unix and Redox; the corresponding Windows helpers return false.

Sources: [src/cli.rs:333-349](repo://src/cli.rs#L333-L349), [src/filetypes.rs:20-42](repo://src/filetypes.rs#L20-L42), [src/filesystem.rs:62-100](repo://src/filesystem.rs#L62-L100)

`--type executable` enables regular files and adds an executable-access test using `faccess`. `--type empty` adds an emptiness test; when neither files nor directories was explicitly selected, configuration enables both. These are extra predicates on the enabled categories, rather than additional independent categories that can satisfy a union. For example, combining empty with file selects empty regular files.

Sources: [src/main.rs:333-359](repo://src/main.rs#L333-L359), [src/filetypes.rs:20-42](repo://src/filetypes.rs#L20-L42), [src/cli.rs:344-366](repo://src/cli.rs#L344-L366)

Emptiness is checked against the filesystem. A directory is empty only if `read_dir` succeeds and yields no first entry; a file is empty if metadata reports zero bytes. Other types and failed reads return false. This test does not mean “contains no visible search matches”: ignored or hidden children still make a directory nonempty because the check does not run the search's ignore logic.

Sources: [src/filesystem.rs:44-60](repo://src/filesystem.rs#L44-L60)

## Size boundaries

Size expressions contain an optional sign, an integer quantity and a mandatory unit. Units are case-insensitive: `b` is bytes, `k/m/g/t` use powers of 1000, and `ki/mi/gi/ti` use powers of 1024; larger units may also end in `b`. A plus sign means greater than or equal, a minus sign means less than or equal, and no sign means exact byte equality after unit conversion.

Sources: [src/filter/size.rs:15-74](repo://src/filter/size.rs#L15-L74)

| Expression | Predicate |
| --- | --- |
| `+1k` | At least 1000 bytes |
| `-1k` | At most 1000 bytes |
| `+1kib` | At least 1024 bytes |
| `1b` | Exactly one byte |

Sources: [src/filter/size.rs:33-74](repo://src/filter/size.rs#L33-L74), [src/filter/size.rs:96-117](repo://src/filter/size.rs#L96-L117)

The worker requires `entry_path.is_file()` before reading the size, so directory entries do not pass merely because their metadata has a length. It rejects entries with unavailable metadata and those failing any size constraint. Repeated `--size` options can therefore define an inclusive interval. Invalid syntax is reported by the CLI's `SizeFilter::from_string` parser before traversal.

Sources: [src/walk.rs:557-575](repo://src/walk.rs#L557-L575), [src/cli.rs:412-417](repo://src/cli.rs#L412-L417), [src/filter/size.rs:27-37](repo://src/filter/size.rs#L27-L37)

## Modification-time boundaries

`--changed-within` builds an `After` filter and `--changed-before` builds a `Before` filter. Unlike size bounds, both comparisons are strict: equality with the boundary fails. Both operate on `metadata.modified()`, and both must pass when supplied together. A missing modification timestamp rejects the entry rather than treating its time as zero or ignoring the constraint.

Sources: [src/main.rs:496-518](repo://src/main.rs#L496-L518), [src/filter/time.rs:49-62](repo://src/filter/time.rs#L49-L62), [src/walk.rs:577-591](repo://src/walk.rs#L577-L591)

Time parsing first tries a `jiff::Span`, subtracting it from the current zoned time. It then tries an explicit timestamp, a civil date/time interpreted in the system timezone, and finally unsigned Unix seconds prefixed with `@`. The civil-time conversion chooses the later resolution for ambiguity. The CLI documents durations such as `10h`, `1d` and `35min`, and dates without a time default to midnight. A parse failure becomes a setup error suggesting `fd --help`.

Sources: [src/filter/time.rs:12-15](repo://src/filter/time.rs#L12-L15), [src/filter/time.rs:28-47](repo://src/filter/time.rs#L28-L47), [src/cli.rs:419-429](repo://src/cli.rs#L419-L429), [src/main.rs:496-518](repo://src/main.rs#L496-L518)

## Unix ownership

Owner syntax is an optional user or numeric UID, optionally followed by a colon and group or numeric GID. An omitted side is unconstrained. Prefix either side with `!` to require inequality for that side. Numeric values are parsed directly; names are resolved through `nix` user and group lookup. Multiple colons, unknown names and lookup errors reject the argument.

Sources: [src/cli.rs:460-470](repo://src/cli.rs#L460-L470), [src/filter/owner.rs:24-58](repo://src/filter/owner.rs#L24-L58), [src/filter/owner.rs:76-102](repo://src/filter/owner.rs#L76-L102)

An empty owner string or `:` produces a no-op filter that configuration removes. Otherwise UID and GID checks are conjunctive, and missing metadata rejects the entry. Ownership support is compiled only on Unix, so this option is not a portable cross-platform filter. The parser's tests cover numeric user-only, group-only, combined and negated forms.

Sources: [src/main.rs:268-269](repo://src/main.rs#L268-L269), [src/filter/owner.rs:60-73](repo://src/filter/owner.rs#L60-L73), [src/filter/owner.rs:124-139](repo://src/filter/owner.rs#L124-L139), [src/walk.rs:544-555](repo://src/walk.rs#L544-L555), [src/cli.rs:468-470](repo://src/cli.rs#L468-L470)

## Metadata reuse and failure behavior

`DirEntry` caches the metadata result, including absence, in a `OnceCell`. Ordinary entries ask the underlying walker entry for metadata; reconstructed broken symlinks use `symlink_metadata`. Later predicates can reuse the result instead of issuing the same request repeatedly. Metadata-dependent rejection inside these predicates is distinct from a traversal error sent to the consumer, so `--show-errors` should not be read as a promise to explain every filtered-out result.

Sources: [src/dir_entry.rs:18-22](repo://src/dir_entry.rs#L18-L22), [src/dir_entry.rs:89-96](repo://src/dir_entry.rs#L89-L96), [src/walk.rs:485-505](repo://src/walk.rs#L485-L505), [src/walk.rs:544-591](repo://src/walk.rs#L544-L591)
