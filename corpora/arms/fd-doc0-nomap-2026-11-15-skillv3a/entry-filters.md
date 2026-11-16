---
title: "Entry Filters"
---
## Overview

After an entry's name has matched ([[Pattern Matching]]), fd can still reject it by type, size, modification time or owner. Each of these filters is parsed once into a small value in `Config` and checked on the walker threads for every entry that reaches it. They run after the name and extension checks because most of them need the entry's metadata, which costs a `stat` call; `DirEntry` caches that metadata so all filters share one call. The order in which the walker runs them is on [[Parallel Directory Traversal]].

Sources: [src/walk.rs:537-591](repo://src/walk.rs#L537-L591), [src/dir_entry.rs:89-96](repo://src/dir_entry.rs#L89-L96)

| Flag | Type | Defined in | Platforms |
| --- | --- | --- | --- |
| `--type`/`-t` | `FileTypes` | `src/filetypes.rs` | all (device, socket and pipe types never match on Windows) |
| `--size`/`-S` | `SizeFilter` | `src/filter/size.rs` | all |
| `--changed-within`, `--changed-before` | `TimeFilter` | `src/filter/time.rs` | all |
| `--owner`/`-o` | `OwnerFilter` | `src/filter/owner.rs` | Unix only |

Sources: [src/filter/mod.rs:1-11](repo://src/filter/mod.rs#L1-L11), [src/filesystem.rs:62-100](repo://src/filesystem.rs#L62-L100)

## File types

### Building FileTypes

`--type` may be repeated, and `construct_config` folds all values into one `FileTypes` struct of booleans. Most values switch on their own kind (`f` files, `d` directories, `l` symlinks, `b`, `c`, `s`, `p` for block devices, character devices, sockets and pipes). Two values work differently: `x` (executable) sets `executables_only` and also turns on files, and `e` (empty) sets `empty_only`; if `e` is given without `f` or `d`, both are turned on, so `-te` finds empty files and empty directories.

Sources: [src/main.rs:333-361](repo://src/main.rs#L333-L361), [src/cli.rs:802-823](repo://src/cli.rs#L802-L823)

### should_ignore

`FileTypes::should_ignore` rejects an entry when its type was not asked for, when `executables_only` is set and the path is not executable, when `empty_only` is set and the entry is not empty, or when its type is none of the known kinds. An entry whose file type cannot be read is rejected too.

Sources: [src/filetypes.rs:20-43](repo://src/filetypes.rs#L20-L43)

Executability comes from `faccess::PathExt::executable`, which asks whether the current user may execute the file rather than reading mode bits. `filesystem::is_empty` treats a directory as empty when `read_dir` yields no entry (an unreadable directory is not empty) and a file as empty when its length is 0; other types are never empty.

Sources: [src/filetypes.rs:1-5](repo://src/filetypes.rs#L1-L5), [src/filesystem.rs:44-60](repo://src/filesystem.rs#L44-L60)

## Size

`--size` takes `<+|-><NUM><UNIT>`: `+` means at least, `-` means at most, and no sign means exactly. The unit is required and case-insensitive. Single letters `k`, `m`, `g`, `t` are powers of 1000; `ki`, `mi`, `gi`, `ti` are powers of 1024; an optional trailing `b` is allowed (`kb`, `KiB`), and `b` alone means bytes.

Sources: [src/filter/size.rs:8-66](repo://src/filter/size.rs#L8-L66), [src/cli.rs:395-417](repo://src/cli.rs#L395-L417)

| Argument | Parsed as |
| --- | --- |
| `+1k` | `Min(1000)` |
| `-100ki` | `Max(102400)` |
| `1MiB` | `Equals(1048576)` |
| `+18`, `+1bb`, `9999` | rejected: "is not a valid size constraint" |

Sources: [src/filter/size.rs:96-194](repo://src/filter/size.rs#L96-L194)

clap parses each value with `SizeFilter::from_string`, so a bad size fails before the search. The flag can be repeated and every constraint must hold, so `-S +1k -S -1m` selects files between 1 kB and 1 MB, bounds included (`is_within` uses `>=` and `<=`). Only regular files have a size here: when any size constraint is set, directories, symlinks and other types are rejected, as are files whose metadata cannot be read.

Sources: [src/filter/size.rs:68-75](repo://src/filter/size.rs#L68-L75), [src/walk.rs:557-575](repo://src/walk.rs#L557-L575)

## Modification time

`--changed-within` builds `TimeFilter::After` and keeps entries modified strictly after the limit; `--changed-before` builds `TimeFilter::Before` and keeps entries modified strictly before it. `extract_time_constraints` turns an unparseable value into the error "is not a valid date or duration".

Sources: [src/filter/time.rs:5-63](repo://src/filter/time.rs#L5-L63), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

`TimeFilter::from_str` tries four formats in turn, using the `jiff` crate.

Sources: [src/filter/time.rs:1-3](repo://src/filter/time.rs#L1-L3)

1. A duration (`jiff::Span`) such as `10h`, `1d`, `2weeks`, `35min`: the limit is now minus that span.
2. A timestamp with an offset, such as `2018-10-27T10:00:00+02:00`.
3. A civil date or date-time without an offset, such as `2018-10-27` or `2018-10-27 10:00:00`, read in the system time zone; a date alone means midnight, and a time that is ambiguous because of a DST change takes the later instant.
4. `@` followed by Unix seconds, such as `@1707723412`. A bare number is not accepted.

Sources: [src/filter/time.rs:28-47](repo://src/filter/time.rs#L28-L47), [src/filter/time.rs:169-200](repo://src/filter/time.rs#L169-L200)

Both flags may be given together to select a window, and every constraint must apply. An entry whose metadata or modification time cannot be read is rejected. Tests freeze "now" through a thread-local `TESTTIME`, so durations are checked against a fixed clock.

Sources: [src/walk.rs:577-591](repo://src/walk.rs#L577-L591), [src/filter/time.rs:12-26](repo://src/filter/time.rs#L12-L26)

## Owner

`--owner` takes `[user][:group]`, each side a name or a numeric id, and either side may be prefixed with `!` to exclude instead of require. `OwnerFilter::from_string` splits on `:`, rejects more than one colon, and resolves names with `nix::unistd::User::from_name` and `Group::from_name`, failing for unknown names. Each side becomes a `Check`: `Equal`, `NotEq`, or `Ignore` when it is empty.

Sources: [src/filter/owner.rs:5-58](repo://src/filter/owner.rs#L5-L58), [src/filter/owner.rs:76-103](repo://src/filter/owner.rs#L76-L103)

| Argument | uid check | gid check |
| --- | --- | --- |
| `john` | equal to john's uid | ignored |
| `:students` | ignored | equal to the students gid |
| `!4:!3` | not 4 | not 3 |
| `""` or `:` | ignored | ignored (no filter) |

Sources: [src/filter/owner.rs:124-139](repo://src/filter/owner.rs#L124-L139)

`construct_config` passes the parsed value through `filter_ignore`, which drops a filter that ignores both sides so no metadata is read for nothing. `matches` compares the entry's `uid()` and `gid()` from its metadata; an entry without metadata is rejected.

Sources: [src/filter/owner.rs:60-73](repo://src/filter/owner.rs#L60-L73), [src/main.rs:268-269](repo://src/main.rs#L268-L269), [src/walk.rs:544-555](repo://src/walk.rs#L544-L555)
