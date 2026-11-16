---
title: "File Type, Size, Time and Owner Filters"
---
## Overview

Besides the name patterns, fd can restrict results by what an entry is (`--type`), how big it is (`--size`), when it was last modified (`--changed-within`, `--changed-before`) and, on Unix, who owns it (`--owner`). Each filter is parsed once at startup into a small value type, stored in the `Config`, and tested by the walker's sender threads after the name and extension checks, because these filters may need file metadata while name checks do not.

Sources: [src/walk.rs:537-591](repo://src/walk.rs#L537-L591), [src/config.rs:81-114](repo://src/config.rs#L81-L114)

## Order of evaluation

For an entry whose name matched, the walker applies the filters in this order, and the first one that fails drops the entry.

Sources: [src/walk.rs:537-542](repo://src/walk.rs#L537-L542)

1. `FileTypes::should_ignore` (needs the file type, which the walker usually knows without a stat).
2. `OwnerFilter::matches` on the entry's metadata (Unix only); an entry without metadata is dropped.
3. Every `SizeFilter`, only for regular files; directories and other kinds are dropped whenever a size filter is set.
4. Every `TimeFilter` against the modification time; an entry without a readable modification time is dropped.

Sources: [src/walk.rs:537-591](repo://src/walk.rs#L537-L591)

`DirEntry::metadata` caches the metadata in a `OnceCell`, so the owner, size and time checks share a single stat call per entry.

Sources: [src/dir_entry.rs:89-96](repo://src/dir_entry.rs#L89-L96)

## File types

### Selecting types

`--type` (`-t`) can be repeated; the result is the union of the given types. `construct_config` folds the values into a `FileTypes` struct of booleans. Two values behave differently from the rest: `executable` sets `executables_only` and also enables `files`, and `empty` sets `empty_only` and, when neither `file` nor `directory` was also given, enables both.

Sources: [src/main.rs:333-360](repo://src/main.rs#L333-L360), [src/cli.rs:333-378](repo://src/cli.rs#L333-L378)

| Value | Aliases | Matches |
| --- | --- | --- |
| `file` | `f` | Regular files |
| `directory` | `d`, `dir` | Directories |
| `symlink` | `l` | Symbolic links |
| `executable` | `x` | Files executable by the current effective user |
| `empty` | `e` | Empty files and empty directories |
| `socket` | `s` | Sockets |
| `pipe` | `p` | Named pipes (FIFOs) |
| `block-device` | `b` | Block devices |
| `char-device` | `c` | Character devices |

Sources: [src/cli.rs:802-823](repo://src/cli.rs#L802-L823)

### How an entry is tested

`should_ignore` drops an entry when its kind is not enabled, when `executables_only` is set and the path is not executable (checked with `faccess`), when `empty_only` is set and the entry is not empty, or when it is none of the known kinds. An entry without a file type is always dropped. `filesystem::is_empty` treats a directory as empty when `read_dir` yields no entry, and a file when its length is 0; anything else is never empty. On Windows, the block device, character device, socket and pipe tests always answer false.

Sources: [src/filetypes.rs:1-43](repo://src/filetypes.rs#L1-L43), [src/filesystem.rs:44-100](repo://src/filesystem.rs#L44-L100)

## Size

### Syntax

`--size` takes `<+|-><NUM><UNIT>` and can be repeated; every constraint must hold. `+` means at least, `-` at most, and no sign means exactly. Units are case-insensitive, and the trailing `b` of a multi-letter unit is optional (`k`, `kb`, `ki`, `kib` all parse).

Sources: [src/cli.rs:395-417](repo://src/cli.rs#L395-L417), [src/filter/size.rs:27-66](repo://src/filter/size.rs#L27-L66)

| Unit | Factor |
| --- | --- |
| `b` | 1 |
| `k`, `m`, `g`, `t` | 1000, 1000², 1000³, 1000⁴ |
| `ki`, `mi`, `gi`, `ti` | 1024, 1024², 1024³, 1024⁴ |

Sources: [src/filter/size.rs:15-25](repo://src/filter/size.rs#L15-L25), [src/filter/size.rs:46-57](repo://src/filter/size.rs#L46-L57)

### Parsing

`SizeFilter::from_string` is clap's value parser for the option, so a bad value fails during argument parsing with "is not a valid size constraint". It matches `(?i)^([+-]?)(\d+)(b|[kmgt]i?b?)$` (compiled once into a `OnceLock`), multiplies the number by the unit and returns `Min`, `Max` or `Equals`. `is_within` compares a file length against it inclusively.

Sources: [src/filter/size.rs:1-75](repo://src/filter/size.rs#L1-L75), [src/cli.rs:412-417](repo://src/cli.rs#L412-L417)

```bash
fd -S +10M          # at least 10 MB
fd -S -1ki -tf      # at most 1024 bytes
fd -S +1k -S -1M    # between 1 kB and 1 MB
```

Sources: [src/cli.rs:395-417](repo://src/cli.rs#L395-L417), [src/walk.rs:557-575](repo://src/walk.rs#L557-L575)

## Modification time

`--changed-within` (aliases `--changed-after`, `--newer`, `--change-newer-than`) keeps entries modified strictly after a point in time; `--changed-before` (aliases `--older`, `--change-older-than`) keeps those modified strictly before it. Both can be combined to select a window.

Sources: [src/cli.rs:419-458](repo://src/cli.rs#L419-L458), [src/filter/time.rs:49-62](repo://src/filter/time.rs#L49-L62)

`TimeFilter::from_str` tries four formats in order; the first three are parsed by `jiff`.

Sources: [src/filter/time.rs:28-30](repo://src/filter/time.rs#L28-L30)

1. A duration (`Span`) such as `10h`, `1d`, `35min` or `2weeks`, subtracted from the current local time.
2. A full timestamp with an offset (`Timestamp`), such as `2018-10-27T10:00:00Z`.
3. A civil date or date and time (`YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`), interpreted in the system time zone; when a local time is ambiguous, the later instant is used. A date alone means midnight.
4. `@` followed by seconds since the Unix epoch.

Sources: [src/filter/time.rs:28-47](repo://src/filter/time.rs#L28-L47), [src/cli.rs:419-422](repo://src/cli.rs#L419-L422)

A value no format accepts makes `extract_time_constraints` fail with "is not a valid date or duration". In tests, `now()` reads a thread-local override so the duration cases are deterministic.

Sources: [src/main.rs:496-519](repo://src/main.rs#L496-L519), [src/filter/time.rs:12-26](repo://src/filter/time.rs#L12-L26)

## Owner

`--owner [user][:group]` (Unix only) filters by uid and gid. Each side may be a number or a name, resolved with `User::from_name` or `Group::from_name`; prefix a side with `!` to exclude it instead. An empty side is ignored, and a string with more than one `:` is an error. `filter_ignore` drops a filter that ignores both sides (such as `""` or `":"`), so it costs nothing at walk time.

Sources: [src/filter/owner.rs:1-103](repo://src/filter/owner.rs#L1-L103), [src/main.rs:268-269](repo://src/main.rs#L268-L269)

| Value | Meaning |
| --- | --- |
| `john` | Owned by user `john` |
| `:students` | Group `students` |
| `!john:students` | Group `students`, not owned by `john` |
| `1000:!100` | uid 1000, gid not 100 |

Sources: [src/cli.rs:460-473](repo://src/cli.rs#L460-L473), [src/filter/owner.rs:124-139](repo://src/filter/owner.rs#L124-L139)
