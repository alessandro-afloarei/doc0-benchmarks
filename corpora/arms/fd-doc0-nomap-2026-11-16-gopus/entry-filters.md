---
title: "Entry Filters"
---
## Overview

After an entry's name has matched every pattern and the extension set, the walker thread runs the metadata filters: `--type`, then `--owner` (Unix only), then `--size`, then `--changed-within`/`--changed-before`. Each is optional, each needs nothing beyond the entry's file type or its cached metadata, and the first one that fails drops the entry with `WalkState::Continue`, so a rejected directory is still descended into. A filter never stops traversal; only the ignore rules and `--prune` do that.

Sources: [src/walk.rs:537-591](repo://src/walk.rs#L537-L591)

All four filters are parsed before the walk starts. `--size` and `--owner` are parsed by clap's `value_parser`, so a bad value fails during argument parsing; the time filters are parsed in `construct_config` (see [[Command-Line Options and Config]]). Metadata comes from `DirEntry::metadata`, which reads it at most once per entry (see [[Parallel Directory Walk]]).

Sources: [src/cli.rs:412-417](repo://src/cli.rs#L412-L417), [src/cli.rs:469-473](repo://src/cli.rs#L469-L473), [src/main.rs:496-519](repo://src/main.rs#L496-L519), [src/dir_entry.rs:89-96](repo://src/dir_entry.rs#L89-L96)

| Filter | Flag | Type | Rejects an entry when |
| --- | --- | --- | --- |
| File type | `-t`, `--type` | `FileTypes` | its type was not asked for, or it fails the executable or empty test |
| Owner | `-o`, `--owner` | `OwnerFilter` | its uid or gid check fails, or it has no metadata |
| Size | `-S`, `--size` | `Vec<SizeFilter>` | it is not a regular file, has no metadata, or any limit fails |
| Modification time | `--changed-within`, `--changed-before` | `Vec<TimeFilter>` | it has no modification time, or any limit fails |

Sources: [src/walk.rs:537-591](repo://src/walk.rs#L537-L591)

## File type

`--type` can be repeated, and each value turns on one flag in `FileTypes`. `construct_config` adds two special cases: `executable` also turns on `files`, so `-tx` means executable regular files, and `empty` on its own turns on both `files` and `directories`, so `-te` finds empty files and empty directories while `-te -tf` narrows it to files.

Sources: [src/main.rs:333-360](repo://src/main.rs#L333-L360), [src/cli.rs:333-378](repo://src/cli.rs#L333-L378)

| Value | Aliases | Selects |
| --- | --- | --- |
| `file` | `f` | regular files |
| `directory` | `d`, `dir` | directories |
| `symlink` | `l` | symbolic links |
| `block-device` | `b` | block devices |
| `char-device` | `c` | character devices |
| `socket` | `s` | sockets |
| `pipe` | `p` | named pipes (FIFOs) |
| `executable` | `x` | files executable by the current effective user |
| `empty` | `e` | empty files or directories |

Sources: [src/cli.rs:802-823](repo://src/cli.rs#L802-L823)

`FileTypes::should_ignore` rejects an entry whose file type is unknown, whose kind was not selected, which is not executable when `executables_only` is set, or which is not empty when `empty_only` is set. A final clause drops entries that are none of the seven known kinds. Executability is checked with `faccess`'s `executable()` on the path; emptiness with `filesystem::is_empty`.

Sources: [src/filetypes.rs:6-42](repo://src/filetypes.rs#L6-L42)

`is_empty` treats a directory as empty when `read_dir` yields no entry, and a file as empty when its length is 0. A directory that cannot be read, and every other kind of entry, counts as not empty. On Windows the block-device, char-device, socket and pipe tests always answer false.

Sources: [src/filesystem.rs:44-100](repo://src/filesystem.rs#L44-L100)

The type comes from the walker. Without `--follow` a symlink reports itself as a symlink; with `--follow` the walker reports its target's type. A broken symlink's type is read from the link itself, so `-tl` finds broken links too.

Sources: [src/dir_entry.rs:82-87](repo://src/dir_entry.rs#L82-L87), [src/walk.rs:485-499](repo://src/walk.rs#L485-L499)

## Owner

`--owner` (Unix only) takes `[user][:group]`, each side a numeric id or a name and each optionally preceded by `!` to negate it. `OwnerFilter::from_string` splits on `:` and refuses more than one colon. A side that is not a number is resolved with `nix`'s `User::from_name` or `Group::from_name`, and an unknown name is an error.

Sources: [src/filter/owner.rs:18-58](repo://src/filter/owner.rs#L18-L58), [src/filter/owner.rs:76-103](repo://src/filter/owner.rs#L76-L103), [src/cli.rs:460-473](repo://src/cli.rs#L460-L473)

Each side becomes a `Check`: `Equal(id)`, `NotEq(id)`, or `Ignore` when the side is empty or missing. `matches` compares the entry's `uid()` and `gid()` from its metadata. A value that ignores both sides (`""` or `":"`) is dropped by `filter_ignore` in `construct_config`, so it costs no metadata read.

Sources: [src/filter/owner.rs:5-16](repo://src/filter/owner.rs#L5-L16), [src/filter/owner.rs:60-82](repo://src/filter/owner.rs#L60-L82), [src/main.rs:268-269](repo://src/main.rs#L268-L269)

| Value | uid check | gid check |
| --- | --- | --- |
| `5` | equal to 5 | none |
| `:8` | none | equal to 8 |
| `9:3` | equal to 9 | equal to 3 |
| `!4:!3` | not 4 | not 3 |
| `6:!8` | equal to 6 | not 8 |
| `3:5:` | error | error |

Sources: [src/filter/owner.rs:124-139](repo://src/filter/owner.rs#L124-L139)

## Size

`--size` takes `<+|-><number><unit>` and can be repeated; every limit must hold. The value must match `(?i)^([+-]?)(\d+)(b|[kmgt]i?b?)$`, so a unit is required and case does not matter. `+` gives `Min` (at least), `-` gives `Max` (at most), and no sign gives `Equals`.

Sources: [src/filter/size.rs:8-13](repo://src/filter/size.rs#L8-L13), [src/filter/size.rs:27-74](repo://src/filter/size.rs#L27-L74), [src/cli.rs:395-417](repo://src/cli.rs#L395-L417)

| Unit | Multiplier |
| --- | --- |
| `b` | 1 |
| `k`, `kb` | 1,000 |
| `ki`, `kib` | 1,024 |
| `m`, `mb` | 1,000,000 |
| `mi`, `mib` | 1,048,576 |
| `g`, `gb` / `gi`, `gib` | 10^9 / 2^30 |
| `t`, `tb` / `ti`, `tib` | 10^12 / 2^40 |

Sources: [src/filter/size.rs:15-25](repo://src/filter/size.rs#L15-L25), [src/filter/size.rs:46-57](repo://src/filter/size.rs#L46-L57)

The walker applies size limits only to regular files: when any `--size` is given, every entry for which `is_file()` is false is rejected, so directories and symlinks to non-files disappear from the results. That is also why `--prune` conflicts with `--size`.

Sources: [src/walk.rs:557-575](repo://src/walk.rs#L557-L575), [src/cli.rs:326-331](repo://src/cli.rs#L326-L331)

## Modification time

`--changed-within` (aliases `--changed-after`, `--change-newer-than`, `--newer`) keeps entries modified after a point in time; `--changed-before` (aliases `--change-older-than`, `--older`) keeps entries modified before it. Both can be given at once to select a window, and both comparisons are strict.

Sources: [src/cli.rs:419-458](repo://src/cli.rs#L419-L458), [src/filter/time.rs:49-62](repo://src/filter/time.rs#L49-L62)

`TimeFilter::from_str` tries four formats in order, using `jiff`:

Sources: [src/filter/time.rs:1-3](repo://src/filter/time.rs#L1-L3), [src/filter/time.rs:28-47](repo://src/filter/time.rs#L28-L47)

1. a duration such as `10h`, `1d`, `35min` or `2weeks`, subtracted from the current time;
2. a timestamp with an offset, such as `2010-10-10T10:10:10+00:00`;
3. a civil date-time or date, such as `2018-10-27 10:00:00` or `2018-10-27`, read in the system time zone (midnight when the time is missing; the later instant when the local time is ambiguous);
4. `@` followed by Unix seconds, such as `@1707723412`.

Sources: [src/filter/time.rs:28-47](repo://src/filter/time.rs#L28-L47), [src/cli.rs:419-422](repo://src/cli.rs#L419-L422)

A bare number without `@` is none of these and is refused; `construct_config` reports any unparseable value as "not a valid date or duration". The tests replace `now()` with a thread-local fixed time so durations are checked against a known reference.

Sources: [src/filter/time.rs:12-26](repo://src/filter/time.rs#L12-L26), [src/filter/time.rs:178-182](repo://src/filter/time.rs#L178-L182), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

In the walker, an entry passes only when its metadata and `modified()` time are available and every time filter applies to that time.

Sources: [src/walk.rs:577-591](repo://src/walk.rs#L577-L591)
