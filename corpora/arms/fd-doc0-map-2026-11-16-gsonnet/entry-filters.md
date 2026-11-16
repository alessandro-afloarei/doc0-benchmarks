---
title: "Entry Filters"
---
## Overview

Every entry the walker produces passes through a chain of predicates inside the sender closure before it is queued for printing or execution. The chain is ordered so that checks which need only the path run before checks which need file metadata, and an entry is dropped at the first predicate that rejects it. The closure and its early exits are described in [[Traversal and Result Pipeline]]; this page lists each predicate and what it costs.

Sources: [src/walk.rs:508-591](repo://src/walk.rs#L508-L591)

| Order | Filter | Needs metadata | Config field |
| --- | --- | --- | --- |
| 1 | Minimum depth | no | `min_depth` |
| 2 | Pattern(s) | no | patterns passed to `scan` |
| 3 | Extension | no | `extensions` |
| 4 | File type | file type, sometimes more | `file_types` |
| 5 | Owner (Unix) | yes | `owner_constraint` |
| 6 | Size | yes | `size_constraints` |
| 7 | Modification time | yes | `time_constraints` |

Sources: [src/walk.rs:508-591](repo://src/walk.rs#L508-L591)

Depth limits that cut the walk short, ignore rules, `--exclude` and `--ignore-contain` act earlier, inside the walker. Those are covered in [[Traversal and Result Pipeline]].

Sources: [src/walk.rs:347-365](repo://src/walk.rs#L347-L365), [src/walk.rs:470-479](repo://src/walk.rs#L470-L479)

## Depth and pattern

`--min-depth` is checked first. A broken symlink has no depth, so when a minimum is set it is dropped as well. The maximum depth is not a filter: it is passed to the walker so deeper directories are never read.

Sources: [src/walk.rs:508-512](repo://src/walk.rs#L508-L512), [src/walk.rs:365](repo://src/walk.rs#L365), [src/dir_entry.rs:98-103](repo://src/dir_entry.rs#L98-L103)

The pattern check works on a byte string chosen by `search_str_for_entry`. Without `--full-path` this is only the file name. With `--full-path`, `full_path_base` is set and the string is the absolute path: an already absolute path is used as is, otherwise a leading `.` is stripped and the path is joined to the cached current directory. Every pattern must match (`.all`), which is how `--and` expressions combine. Bytes come from `osstr_to_bytes`: the raw bytes on Unix, a lossy UTF-8 conversion on Windows.

Sources: [src/walk.rs:514-524](repo://src/walk.rs#L514-L524), [src/walk.rs:656-678](repo://src/walk.rs#L656-L678), [src/filesystem.rs:102-116](repo://src/filesystem.rs#L102-L116)

## Extensions

`--extension` values were turned into a case-insensitive `RegexSet` of `.\.ext$` in [[Pattern and Config Setup]]. The filter matches it against the file name only, so directories whose names end with the extension also pass, and an entry with no file name is rejected.

Sources: [src/walk.rs:526-535](repo://src/walk.rs#L526-L535), [src/main.rs:361-373](repo://src/main.rs#L361-L373)

## File types

`FileTypes` is a set of booleans, one for each kind, plus `executables_only` and `empty_only`. When `--type` is not given, `config.file_types` is `None` and nothing is filtered by type. `should_ignore` returns true, meaning drop the entry, if any of these hold:

- the entry's kind (file, directory, symlink, block device, char device, socket, pipe) is not enabled;
- `executables_only` is set and the path is not executable for the current user (checked with `faccess`);
- `empty_only` is set and `filesystem::is_empty` says no;
- the kind is none of the known ones, or the file type cannot be read at all.

Sources: [src/filetypes.rs:6-43](repo://src/filetypes.rs#L6-L43), [src/walk.rs:537-542](repo://src/walk.rs#L537-L542)

`is_empty` is true for a directory whose `read_dir` yields nothing, or a regular file of length 0; anything else, including an unreadable directory, counts as non-empty. Device, socket and pipe checks exist only on Unix and Redox; on Windows they are constant `false`.

Sources: [src/filesystem.rs:44-60](repo://src/filesystem.rs#L44-L60), [src/filesystem.rs:62-100](repo://src/filesystem.rs#L62-L100)

## Owner

The owner filter is compiled only on Unix. `OwnerFilter::from_string` splits `user:group` at the single colon; more than one colon is an error. Each part is a numeric id or a name looked up with `User::from_name` / `Group::from_name`, and a leading `!` negates it. An empty part means "ignore", and if both parts are ignored `filter_ignore` returns `None` so no filter is stored. At match time the entry's metadata uid and gid must satisfy both checks; an entry whose metadata cannot be read is rejected.

Sources: [src/filter/owner.rs:5-74](repo://src/filter/owner.rs#L5-L74), [src/filter/owner.rs:76-98](repo://src/filter/owner.rs#L76-L98), [src/walk.rs:544-555](repo://src/walk.rs#L544-L555), [src/main.rs:268-269](repo://src/main.rs#L268-L269)

## Size

`SizeFilter::from_string` accepts an optional sign, digits, and a unit matched case-insensitively by the regex `^([+-]?)(\d+)(b|[kmgt]i?b?)$`. A unit starting with `ki`, `mi`, `gi` or `ti` is binary (1024-based); `k`, `m`, `g`, `t` alone are decimal (1000-based); `b` is bytes. The sign selects `Min` (`+`, size at least), `Max` (`-`, size at most) or `Equals` (no sign).

Sources: [src/filter/size.rs:6-75](repo://src/filter/size.rs#L6-L75)

The filter applies only to regular files: when any size constraint exists, a non-file entry is rejected outright, as is a file whose metadata cannot be read. A file must satisfy every constraint, so `-S +1k -S -1m` selects a range.

Sources: [src/walk.rs:557-575](repo://src/walk.rs#L557-L575)

## Modification time

`TimeFilter` is either `Before` or `After` a `SystemTime`, built from `--changed-before` and `--changed-within`. `TimeFilter::from_str` tries four formats in order:

1. A duration span such as `10h` or `2weeks`, subtracted from the current time.
2. A full timestamp such as `2018-10-27T10:00:00Z`.
3. A civil date or date-time, read in the system time zone; for an ambiguous local time it takes the later instant.
4. `@` followed by Unix seconds.

An unparseable value makes `extract_time_constraints` fail with "is not a valid date or duration".

Sources: [src/filter/time.rs:28-55](repo://src/filter/time.rs#L28-L55), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

`applies_to` is a strict comparison: `Before` means the modification time is less than the limit, `After` greater than it. In the sender, all constraints must hold, and an entry with no readable modification time does not match.

Sources: [src/filter/time.rs:57-62](repo://src/filter/time.rs#L57-L62), [src/walk.rs:577-591](repo://src/walk.rs#L577-L591)

## Cost of metadata

`DirEntry::metadata` is computed once and cached in a `OnceCell`, so owner, size, time, `empty` and colouring share one `stat`. Because pattern and extension checks run first and need none, a search that mostly rejects on the name never touches metadata for those entries.

Sources: [src/dir_entry.rs:17-22](repo://src/dir_entry.rs#L17-L22), [src/dir_entry.rs:89-96](repo://src/dir_entry.rs#L89-L96), [src/walk.rs:514-524](repo://src/walk.rs#L514-L524)
