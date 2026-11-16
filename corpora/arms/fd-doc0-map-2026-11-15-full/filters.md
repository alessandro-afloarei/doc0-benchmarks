---
title: "Filters"
---
## Overview

Besides the name patterns, fd can keep or drop an entry by its type, extension, size, modification time and owner. Each filter is parsed once, at startup or by clap, into a small value stored in `Config`; the walker threads then call it on every entry that matched the patterns. Filters that need metadata run last, so the `stat` call is only made for entries that are still candidates ([[Directory Traversal]]).

Sources: [src/walk.rs:526-591](repo://src/walk.rs#L526-L591), [src/filter/mod.rs:1-11](repo://src/filter/mod.rs#L1-L11)

All filters combine with AND: an entry must pass every filter given. Within `--type`, values combine with OR, and so do repeated `--extension` values.

Sources: [src/walk.rs:526-591](repo://src/walk.rs#L526-L591), [src/main.rs:333-373](repo://src/main.rs#L333-L373)

## File types

### The FileTypes value

`--type` values set fields of `FileTypes`, a struct of booleans: one per kind (`files`, `directories`, `symlinks`, `block_devices`, `char_devices`, `sockets`, `pipes`) plus the two modifiers `executables_only` and `empty_only`. `construct_config` makes `executable` also select `files`, and makes `empty` alone select both files and directories.

Sources: [src/filetypes.rs:6-18](repo://src/filetypes.rs#L6-L18), [src/main.rs:333-360](repo://src/main.rs#L333-L360)

### should_ignore

`FileTypes::should_ignore` drops an entry when its kind was not selected, when `executables_only` is set and the path is not executable by the current user (checked with `faccess`), when `empty_only` is set and the entry is not empty, or when the entry is none of the known kinds. An entry with no file type is always dropped.

Sources: [src/filetypes.rs:20-43](repo://src/filetypes.rs#L20-L43)

`filesystem::is_empty` treats a directory as empty when `read_dir` yields no entry, and a file as empty when its length is zero; any other kind is never empty. The device, socket and pipe checks use Unix `FileTypeExt` and always answer false on Windows.

Sources: [src/filesystem.rs:44-100](repo://src/filesystem.rs#L44-L100)

## Extensions

`--extension` values become one `RegexSet`. A leading dot is trimmed, the rest is escaped and wrapped as `.\.ext$`, and the set is case-insensitive. The leading `.` in the regex requires at least one character before the dot, so `-e gitignore` does not match a file named `.gitignore`. The set is matched against the file name only, and an entry without a file name is dropped.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/walk.rs:526-535](repo://src/walk.rs#L526-L535)

## Size

`SizeFilter::from_string` is clap's value parser for `--size`. It matches `(?i)^([+-]?)(\d+)(b|[kmgt]i?b?)$`: an optional sign, a number, and a unit that is required.

Sources: [src/filter/size.rs:6-31](repo://src/filter/size.rs#L6-L31), [src/filter/size.rs:33-66](repo://src/filter/size.rs#L33-L66)

| Input | Filter | Keeps files whose size is |
| --- | --- | --- |
| `+10k` | `Min(10000)` | at least 10 000 bytes |
| `-1mi` | `Max(1048576)` | at most 1 MiB |
| `500b` | `Equals(500)` | exactly 500 bytes |

Sources: [src/filter/size.rs:8-25](repo://src/filter/size.rs#L8-L25), [src/filter/size.rs:60-75](repo://src/filter/size.rs#L60-L75)

`k`, `m`, `g` and `t` are powers of 1000, and `ki`, `mi`, `gi` and `ti` are powers of 1024; a trailing `b` is allowed on each. Several `--size` values all have to hold, so `-S +1k -S -1m` gives a range. Only regular files pass a size filter: directories and anything without metadata are dropped.

Sources: [src/filter/size.rs:15-25](repo://src/filter/size.rs#L15-L25), [src/walk.rs:557-575](repo://src/walk.rs#L557-L575)

## Modification time

`--changed-within` builds `TimeFilter::After` and `--changed-before` builds `TimeFilter::Before`. `TimeFilter::from_str` tries four forms in order.

Sources: [src/filter/time.rs:5-55](repo://src/filter/time.rs#L5-L55), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

| Form | Example | Read as |
| --- | --- | --- |
| `jiff` span | `2weeks`, `10min`, `1h` | now minus the span |
| RFC 3339 timestamp | `2024-02-12T07:36:52+00:00` | that instant |
| civil date or date-time | `2018-10-27`, `2018-10-27 10:00:00` | that time in the system time zone; an ambiguous time takes the later instant |
| `@` and Unix seconds | `@1707723412` | that many seconds after the epoch |

Sources: [src/filter/time.rs:28-47](repo://src/filter/time.rs#L28-L47)

`applies_to` compares strictly: `Before` keeps entries modified before the limit and `After` keeps those modified after it. A bare number without `@` is rejected. An entry whose modification time cannot be read never matches. In tests, `now()` reads a thread-local `TESTTIME` so the cases run against a fixed clock.

Sources: [src/filter/time.rs:12-26](repo://src/filter/time.rs#L12-L26), [src/filter/time.rs:57-62](repo://src/filter/time.rs#L57-L62), [src/filter/time.rs:179-180](repo://src/filter/time.rs#L179-L180), [src/walk.rs:577-591](repo://src/walk.rs#L577-L591)

## Owner

`--owner` exists only on Unix. `OwnerFilter::from_string` splits its value on `:` into a user part and a group part; more than one `:` is an error. Each part is a `Check`: empty means `Ignore`, a leading `!` means `NotEq`, otherwise `Equal`. A part is read as a numeric id first, then looked up as a user or group name with `nix`, and an unknown name is an error.

Sources: [src/filter/owner.rs:5-58](repo://src/filter/owner.rs#L5-L58), [src/filter/owner.rs:76-103](repo://src/filter/owner.rs#L76-L103)

| Value | uid check | gid check |
| --- | --- | --- |
| `john` | equal to john's uid | ignore |
| `:students` | ignore | equal to the gid |
| `!john:students` | not john | equal to students |
| empty or `:` | ignore | ignore |

Sources: [src/filter/owner.rs:126-139](repo://src/filter/owner.rs#L126-L139), [src/cli.rs:460-473](repo://src/cli.rs#L460-L473)

A filter that ignores both ids is dropped at startup by `filter_ignore`, so `--owner :` costs nothing. `matches` compares the entry's metadata `uid` and `gid`; an entry without metadata is dropped.

Sources: [src/filter/owner.rs:60-74](repo://src/filter/owner.rs#L60-L74), [src/main.rs:268-269](repo://src/main.rs#L268-L269), [src/walk.rs:544-555](repo://src/walk.rs#L544-L555)
