---
title: "Entry Filters"
---
## Overview

Besides the name pattern, fd can restrict results by what an entry is and by its metadata: `--type`, `--size`, `--changed-within`/`--changed-before` and, on Unix, `--owner`. Each filter has a small type that parses its option once and answers one question per entry. The types live in `src/filetypes.rs` and `src/filter/`; `construct_config` stores them in `Config` as `file_types`, `size_constraints`, `time_constraints` and `owner_constraint`.

Sources: [src/filter/mod.rs:1-11](repo://src/filter/mod.rs#L1-L11), [src/config.rs:81-114](repo://src/config.rs#L81-L114)

The sender closure applies them after the name and extension checks, in the order file type, owner, size, time, and drops the entry at the first that fails; [[Parallel Directory Walk]] shows that order and how metadata is fetched at most once per entry.

Sources: [src/walk.rs:537-591](repo://src/walk.rs#L537-L591)

| Filter | Option | Parsed by | Checked by |
| --- | --- | --- | --- |
| File type | `-t`/`--type` | clap `ValueEnum` `FileType`, folded in `construct_config` | `FileTypes::should_ignore` |
| Size | `-S`/`--size` | `SizeFilter::from_string` | `SizeFilter::is_within` |
| Modification time | `--changed-within`, `--changed-before` | `TimeFilter::after` / `TimeFilter::before` | `TimeFilter::applies_to` |
| Owner (Unix) | `-o`/`--owner` | `OwnerFilter::from_string` | `OwnerFilter::matches` |

Sources: [src/cli.rs:367-473](repo://src/cli.rs#L367-L473), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

## File types

### Selecting types

`--type` can be repeated, and each value has a short alias: `f` file, `d`/`dir` directory, `l` symlink, `b` block device, `c` char device, `x` executable, `e` empty, `s` socket, `p` pipe. `construct_config` turns the list into a `FileTypes` struct of booleans. Two values are modifiers rather than types: `executable` sets `executables_only` and also `files`, and `empty` sets `empty_only`; if `empty` is given without `file` or `directory`, both are enabled.

Sources: [src/cli.rs:802-823](repo://src/cli.rs#L802-L823), [src/main.rs:333-360](repo://src/main.rs#L333-L360), [src/filetypes.rs:6-18](repo://src/filetypes.rs#L6-L18)

The help text spells out the combinations: `-tf -tl` shows files and symlinks, `-tx` finds executable files, `-te -tf` finds empty files and `-te -td` empty directories.

Sources: [src/cli.rs:333-366](repo://src/cli.rs#L333-L366)

### Type evaluation

`should_ignore` returns true, rejecting the entry, when its type is one that was not selected, when `executables_only` is set and the path is not executable, when `empty_only` is set and the entry is not empty, or when the type is none of the known kinds. An entry whose type cannot be determined is always rejected.

Sources: [src/filetypes.rs:20-43](repo://src/filetypes.rs#L20-L43)

"Executable" uses `faccess`'s `executable()` check, which the `FileType::Executable` comment defines as executable by the current effective user. "Empty" comes from `filesystem::is_empty`: a directory is empty when `read_dir` yields no entry, a file when its length is 0, and anything else, or an unreadable directory, is not empty.

Sources: [src/filetypes.rs:4-4](repo://src/filetypes.rs#L4-L4), [src/cli.rs:814-816](repo://src/cli.rs#L814-L816), [src/filesystem.rs:44-60](repo://src/filesystem.rs#L44-L60)

Block devices, char devices, sockets and pipes are detected through `FileTypeExt` on Unix and Redox. On Windows those helpers always return false, so those types never match there.

Sources: [src/filesystem.rs:62-100](repo://src/filesystem.rs#L62-L100)

## Size

### Size syntax

A size constraint is `<+-><NUM><UNIT>`, matched case-insensitively by the regex `^([+-]?)(\d+)(b|[kmgt]i?b?)$`. `+` means at least, `-` at most, and no sign means exactly. A unit is required: `b` for bytes, `k`, `m`, `g`, `t` for powers of 1000, and `ki`, `mi`, `gi`, `ti` for powers of 1024, each optionally followed by `b`, so `1kb` and `1K` are both 1000 bytes and `10ki` is 10,240.

Sources: [src/filter/size.rs:8-66](repo://src/filter/size.rs#L8-L66), [src/cli.rs:395-417](repo://src/cli.rs#L395-L417)

`--size` is repeatable and accepts hyphen-prefixed values, so `-S +1k -S -1m` reads as a range. An invalid value fails parsing with "is not a valid size constraint". `--size` conflicts with `--prune`.

Sources: [src/cli.rs:326-331](repo://src/cli.rs#L326-L331), [src/cli.rs:412-417](repo://src/cli.rs#L412-L417), [src/filter/size.rs:28-31](repo://src/filter/size.rs#L28-L31)

### Size evaluation

`is_within` compares the file's length with `<=`, `>=` or `==`. The sender requires every constraint to hold and applies size constraints only to regular files: with any `--size` given, directories, symlinks and entries without readable metadata are excluded.

Sources: [src/filter/size.rs:68-74](repo://src/filter/size.rs#L68-L74), [src/walk.rs:557-575](repo://src/walk.rs#L557-L575)

## Modification time

### Time syntax

`--changed-within` (aliases `--changed-after`, `--change-newer-than`, `--newer`) builds `TimeFilter::After`, and `--changed-before` (`--change-older-than`, `--older`) builds `TimeFilter::Before`. Both take one value, so at most one of each exists. `TimeFilter::from_str` tries the formats in order.

Sources: [src/filter/time.rs:28-55](repo://src/filter/time.rs#L28-L55)

1. A `jiff::Span` duration such as `10h`, `1d`, `35min` or `2weeks`, subtracted from the current zoned time.
2. A `jiff::Timestamp` with an offset, such as `2010-10-10T10:10:00+00:00`.
3. A civil `DateTime` such as `2018-10-27 10:00:00` or `2018-10-27`, read in the system time zone, taking the later instant when the local time is ambiguous.
4. `@` followed by Unix epoch seconds.

Sources: [src/filter/time.rs:5-55](repo://src/filter/time.rs#L5-L55), [src/cli.rs:419-458](repo://src/cli.rs#L419-L458)

A bare number is not a timestamp: the tests check that `1707723412` is rejected while `@1707723412` is accepted. A value that parses as none of these makes `extract_time_constraints` fail with "is not a valid date or duration".

Sources: [src/filter/time.rs:180-201](repo://src/filter/time.rs#L180-L201), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

### Time evaluation

`applies_to` is strict: `After` needs a modification time later than the limit and `Before` an earlier one. Given both options, an entry must satisfy both, which selects a window. Entries whose metadata or modification time cannot be read are excluded.

Sources: [src/filter/time.rs:57-62](repo://src/filter/time.rs#L57-L62), [src/walk.rs:577-591](repo://src/walk.rs#L577-L591)

For tests, `now()` is replaced by a thread-local `TESTTIME` that `TestTime` sets and clears, so duration-based filters can be checked against a fixed clock.

Sources: [src/filter/time.rs:12-26](repo://src/filter/time.rs#L12-L26), [src/filter/time.rs:70-93](repo://src/filter/time.rs#L70-L93)

## Owner

### Owner syntax

`--owner` exists only on Unix. Its format is `[(user|uid)][:(group|gid)]`: either side may be omitted, and a leading `!` on a side negates it. `from_string` splits on `:` and errors when more than one colon is present. Each side becomes a `Check`: `Ignore` when empty, `Equal` or `NotEq` otherwise. A numeric value is used as an id directly; otherwise the name is resolved with `nix`'s `User::from_name` or `Group::from_name`, and an unknown name is an error.

Sources: [src/filter/owner.rs:5-58](repo://src/filter/owner.rs#L5-L58), [src/filter/owner.rs:76-103](repo://src/filter/owner.rs#L76-L103), [src/cli.rs:460-473](repo://src/cli.rs#L460-L473)

| Input | uid | gid |
| --- | --- | --- |
| `5` | `Equal(5)` | `Ignore` |
| `:8` | `Ignore` | `Equal(8)` |
| `!4:!3` | `NotEq(4)` | `NotEq(3)` |
| `6:!8` | `Equal(6)` | `NotEq(8)` |
| `""`, `:` | `Ignore` | `Ignore` |
| `3:5:`, `::` | error | error |

Sources: [src/filter/owner.rs:120-139](repo://src/filter/owner.rs#L120-L139)

### Owner evaluation

A filter that ignores both sides would match everything, so `construct_config` passes the parsed value through `filter_ignore`, which turns it into `None` and skips the check entirely. Otherwise `matches` compares the entry's `uid()` and `gid()` from its metadata against both checks; an entry without metadata is excluded.

Sources: [src/filter/owner.rs:60-74](repo://src/filter/owner.rs#L60-L74), [src/main.rs:268-269](repo://src/main.rs#L268-L269), [src/walk.rs:544-555](repo://src/walk.rs#L544-L555)
