---
title: "Entry Filters"
---
## Overview

After an entry's name matches every pattern, the sender thread runs it through the filters the user asked for. Each filter is an `Option` or a list in `Config`; an empty one costs nothing. They run in a fixed order, cheapest first: extension, file type, owner, size, modification time. The first filter that rejects an entry returns `WalkState::Continue`, which drops the entry but still walks into it when it is a directory.

Sources: [src/walk.rs:526-591](repo://src/walk.rs#L526-L591)

The loop that calls them is on [[Parallel Directory Walk]]; how the flags are parsed into `Config` is on [[Command-Line Options and Configuration]]. The depth limits are listed last because they act elsewhere in the walk.

Sources: [src/main.rs:325-373](repo://src/main.rs#L325-L373)

| Filter | Flag | Needs metadata | Applies to |
| --- | --- | --- | --- |
| Extension | `-e`/`--extension` | no | every entry with a file name |
| File type | `-t`/`--type` | file type, plus `stat` or `read_dir` for `executable` and `empty` | every entry |
| Owner | `-o`/`--owner` (Unix) | yes | every entry |
| Size | `-S`/`--size` | yes | regular files only |
| Modification time | `--changed-within`, `--changed-before` | yes | every entry |

Sources: [src/walk.rs:526-591](repo://src/walk.rs#L526-L591), [src/filetypes.rs:20-42](repo://src/filetypes.rs#L20-L42)

## Extension

`-e` may repeat. `construct_config` strips leading dots from each value and builds one case-insensitive `RegexSet` of `.\.<ext>$` patterns, with the extension escaped. The visitor matches it against the entry's file name as bytes, and drops entries without a file name. The leading `.` in the pattern requires a character before the dot, so `-e foo` does not match a file named `.foo`. Directories whose names end in the extension also match unless `--type` narrows the search.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/walk.rs:526-535](repo://src/walk.rs#L526-L535), [src/cli.rs:380-393](repo://src/cli.rs#L380-L393)

## File type

### Selecting types

Each `--type` value turns on a field of `FileTypes`. The values and their short aliases are `file` (`f`), `directory` (`d`, `dir`), `symlink` (`l`), `block-device` (`b`), `char-device` (`c`), `socket` (`s`), `pipe` (`p`), `executable` (`x`) and `empty` (`e`). `executable` turns on `files` as well as `executables_only`. `empty` alone selects both files and directories; together with `--type file` or `--type directory` it narrows to that type.

Sources: [src/cli.rs:802-823](repo://src/cli.rs#L802-L823), [src/main.rs:333-360](repo://src/main.rs#L333-L360), [src/filetypes.rs:6-18](repo://src/filetypes.rs#L6-L18)

### should_ignore

`FileTypes::should_ignore` rejects an entry whose type was not selected, a non-executable entry when `executables_only` is set, a non-empty entry when `empty_only` is set, and any entry whose type is none of the known kinds. An entry with no file type is always rejected. Executability comes from the `faccess` crate's `executable()` check on the path, which the CLI describes as executable by the current effective user.

Sources: [src/filetypes.rs:20-42](repo://src/filetypes.rs#L20-L42), [src/cli.rs:814-816](repo://src/cli.rs#L814-L816)

`filesystem::is_empty` treats a directory as empty when `read_dir` yields no entry, and a regular file when its metadata length is 0; everything else, and a directory that cannot be read, is not empty. Block devices, character devices, sockets and pipes are detected through the Unix `FileTypeExt` methods; on Windows those checks always answer false.

Sources: [src/filesystem.rs:44-100](repo://src/filesystem.rs#L44-L100)

## Owner

`--owner` exists only on Unix and takes `[user][:group]`, where each side is a name or a numeric id and may start with `!` to negate it. `OwnerFilter::from_string` splits on `:` and refuses more than one colon. Each side becomes a `Check`: `Equal`, `NotEq`, or `Ignore` for an empty or missing side. Names are resolved once at parse time with `nix`'s `User::from_name` and `Group::from_name`, and an unknown name is an error.

Sources: [src/filter/owner.rs:5-58](repo://src/filter/owner.rs#L5-L58), [src/filter/owner.rs:76-102](repo://src/filter/owner.rs#L76-L102), [src/cli.rs:460-473](repo://src/cli.rs#L460-L473)

`filter_ignore` turns a filter that ignores both sides (`""` or `":"`) into `None`, so it never runs. `matches` compares the entry's `uid` and `gid` from its metadata; an entry whose metadata cannot be read is dropped.

Sources: [src/filter/owner.rs:60-73](repo://src/filter/owner.rs#L60-L73), [src/walk.rs:544-555](repo://src/walk.rs#L544-L555), [src/main.rs:268-269](repo://src/main.rs#L268-L269)

| Value | uid check | gid check |
| --- | --- | --- |
| `5` | equal 5 | ignore |
| `:8` | ignore | equal 8 |
| `9:3` | equal 9 | equal 3 |
| `!4:!3` | not 4 | not 3 |
| `6:!8` | equal 6 | not 8 |
| `3:5:` | error | error |

Sources: [src/filter/owner.rs:125-139](repo://src/filter/owner.rs#L125-L139)

## Size

### Size syntax

`-S` takes `<+|-><number><unit>`, matched case-insensitively by `^([+-]?)(\d+)(b|[kmgt]i?b?)$`. `+` means at least, `-` at most, and no sign means exactly. A unit is required: `b` for bytes, `k`, `m`, `g`, `t` for powers of 1000, and `ki`, `mi`, `gi`, `ti` for powers of 1024, each with an optional trailing `b`. Invalid values such as `+18` or `+1bb` are refused by clap through `SizeFilter::from_string`.

Sources: [src/filter/size.rs:8-75](repo://src/filter/size.rs#L8-L75), [src/cli.rs:395-417](repo://src/cli.rs#L395-L417)

### Applying size constraints

`-S` may repeat, and an entry must satisfy every constraint, so `-S +1k -S -1m` selects a range. Only regular files have a size here: when any size constraint is set, entries that are not files (checked with `Path::is_file`, which follows symlinks) and entries without metadata are dropped. clap makes `--size` conflict with `--prune`.

Sources: [src/walk.rs:557-575](repo://src/walk.rs#L557-L575), [src/cli.rs:326-331](repo://src/cli.rs#L326-L331)

## Modification time

### Accepted values

`--changed-within` (aliases `--newer`, `--changed-after`, `--change-newer-than`) builds `TimeFilter::After`, and `--changed-before` (aliases `--older`, `--change-older-than`) builds `TimeFilter::Before`. `TimeFilter::from_str` tries, in order: a `jiff` span such as `10h`, `1d` or `2weeks`, subtracted from the current time; an RFC 3339 timestamp with offset; a civil date-time or date such as `2018-10-27` or `2018-10-27 10:00:00`, read in the system time zone (taking the later time when it is ambiguous, and midnight when no time is given); and `@<seconds>` since the Unix epoch. A bare number is not a timestamp.

Sources: [src/filter/time.rs:5-55](repo://src/filter/time.rs#L5-L55), [src/cli.rs:419-458](repo://src/cli.rs#L419-L458)

### Applying time constraints

Durations are resolved once, when the options are parsed, so every entry is compared with the same instant. `applies_to` is strict: `After` keeps times later than the limit, `Before` keeps earlier ones. Both flags can be combined and both must hold. An entry whose metadata or modification time cannot be read is dropped.

Sources: [src/filter/time.rs:57-62](repo://src/filter/time.rs#L57-L62), [src/walk.rs:577-591](repo://src/walk.rs#L577-L591), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

## Depth limits

`--max-depth` is passed to the `ignore` walker, which does not descend below it (see [[Ignore Rules and Exclusions]]). `--min-depth` is checked in the visitor before the pattern match, and entries above it are dropped while their subtrees are still walked. `--exact-depth n` sets both. A depth of 1 means entries directly in the search root.

Sources: [src/cli.rs:278-308](repo://src/cli.rs#L278-L308), [src/cli.rs:747-753](repo://src/cli.rs#L747-L753), [src/walk.rs:508-512](repo://src/walk.rs#L508-L512), [src/config.rs:49-56](repo://src/config.rs#L49-L56)
