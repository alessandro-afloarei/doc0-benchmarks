---
title: "Entry Filters"
---
## Overview

Besides the search patterns and `--extension` ([[Pattern Matching]]), four filters can drop an entry: file type (`--type`), owner (`--owner`, Unix only), size (`--size`) and modification time (`--changed-within`, `--changed-before`). Each is parsed once, at startup, into a value in `Config`, and each is tested in the walker callback on the walker's threads ([[Parallel Directory Walk]]).

Sources: [src/config.rs:81-114](repo://src/config.rs#L81-L114), [src/filter/mod.rs:1-11](repo://src/filter/mod.rs#L1-L11)

The callback applies them in a fixed order, after the name checks, and every filter that fails returns `WalkState::Continue`: the entry is not reported, but a directory is still descended into. The type filter usually needs only the file type the walker already has; owner, size and time read metadata through `DirEntry::metadata()`, which stats the entry once and caches the result for the filters after it.

Sources: [src/walk.rs:537-591](repo://src/walk.rs#L537-L591), [src/dir_entry.rs:89-96](repo://src/dir_entry.rs#L89-L96)

| Order | Filter | Option | Config field | Needs metadata |
| --- | --- | --- | --- | --- |
| 1 | File type | `--type` / `-t` | `file_types` | only for `empty` and broken symlinks |
| 2 | Owner | `--owner` / `-o` | `owner_constraint` | yes |
| 3 | Size | `--size` / `-S` | `size_constraints` | yes |
| 4 | Modification time | `--changed-within`, `--changed-before` | `time_constraints` | yes |

Sources: [src/walk.rs:537-591](repo://src/walk.rs#L537-L591)

## File type filter

### Building FileTypes

Each `--type` value sets one flag on a `FileTypes` struct. Values have short aliases: `f` file, `d`/`dir` directory, `l` symlink, `b` block device, `c` char device, `x` executable, `e` empty, `s` socket, `p` pipe. `executable` also sets `files`, and when `empty` is the only kind given, both `files` and `directories` are set, so `-te` finds empty files and empty directories while `-te -tf` finds only empty files.

Sources: [src/cli.rs:802-823](repo://src/cli.rs#L802-L823), [src/main.rs:333-360](repo://src/main.rs#L333-L360), [src/filetypes.rs:6-18](repo://src/filetypes.rs#L6-L18)

### should_ignore

`FileTypes::should_ignore` drops an entry when its file type is unknown, or when it is of a kind whose flag is not set, or when `executables_only` is set and the path is not executable, or when `empty_only` is set and the entry is not empty. It also drops any entry that is none of the seven kinds, so a filter never lets through an unclassified entry.

Sources: [src/filetypes.rs:20-43](repo://src/filetypes.rs#L20-L43)

Executability is checked with `faccess::PathExt::executable`, which tests whether the current effective user may execute the path, not just the mode bits. Emptiness comes from `filesystem::is_empty`: a directory is empty when `read_dir` yields no entry, a file when its metadata length is zero; a directory that cannot be read, and every other kind, count as not empty.

Sources: [src/filetypes.rs:1-4](repo://src/filetypes.rs#L1-L4), [src/cli.rs:814-816](repo://src/cli.rs#L814-L816), [src/filesystem.rs:44-60](repo://src/filesystem.rs#L44-L60)

The device, socket and pipe checks use the Unix `FileTypeExt` methods. On Windows these helpers always return false, so `-tb`, `-tc`, `-ts` and `-tp` match nothing there.

Sources: [src/filesystem.rs:62-100](repo://src/filesystem.rs#L62-L100)

## Owner filter

`--owner` takes `[user|uid][:group|gid]`. `OwnerFilter::from_string` splits on `:`, rejecting a string with more than one colon. Each side becomes a `Check`: `Ignore` when it is empty or absent, `NotEq` when it starts with `!`, and `Equal` otherwise. A side that parses as a number is used as the id; anything else is looked up with `nix`'s `User::from_name` or `Group::from_name`, and an unknown name is an error.

Sources: [src/filter/owner.rs:1-58](repo://src/filter/owner.rs#L1-L58), [src/filter/owner.rs:76-103](repo://src/filter/owner.rs#L76-L103), [src/cli.rs:460-473](repo://src/cli.rs#L460-L473)

| Value | uid check | gid check |
| --- | --- | --- |
| `john` | equal to john's uid | ignore |
| `:students` | ignore | equal to the students gid |
| `!john:students` | not john | equal to students |
| `5:` | equal to 5 | ignore |
| `""` or `:` | no filter | no filter |

Sources: [src/filter/owner.rs:124-139](repo://src/filter/owner.rs#L124-L139)

`construct_config` passes the parsed value through `filter_ignore`, which turns a filter that ignores both sides into `None`, so `--owner :` costs no stat calls. In the walker, `matches` compares the metadata's `uid()` and `gid()`; an entry without metadata is dropped.

Sources: [src/filter/owner.rs:60-73](repo://src/filter/owner.rs#L60-L73), [src/main.rs:268-269](repo://src/main.rs#L268-L269), [src/walk.rs:544-555](repo://src/walk.rs#L544-L555)

## Size filter

`--size` takes `<+-><NUM><UNIT>` and may be given several times; clap parses each value with `SizeFilter::from_string`. The value must match `(?i)^([+-]?)(\d+)(b|[kmgt]i?b?)$`, so a unit is required, units are case-insensitive, and a trailing `b` is optional. `+` gives `Min`, `-` gives `Max`, and no sign gives `Equals`; all bounds are inclusive.

Sources: [src/filter/size.rs:1-75](repo://src/filter/size.rs#L1-L75), [src/cli.rs:395-417](repo://src/cli.rs#L395-L417)

| Unit | Multiplier |
| --- | --- |
| `b` | 1 |
| `k`, `m`, `g`, `t` (optionally with `b`) | 1000, 1000², 1000³, 1000⁴ |
| `ki`, `mi`, `gi`, `ti` (optionally with `b`) | 1024, 1024², 1024³, 1024⁴ |

Sources: [src/filter/size.rs:15-25](repo://src/filter/size.rs#L15-L25), [src/filter/size.rs:46-57](repo://src/filter/size.rs#L46-L57)

The walker applies size constraints only to entries for which `entry_path.is_file()` is true: when any `--size` is given, directories and other non-files are dropped. A file passes only when it is within every constraint, so `-S +1k -S -1M` gives a range. `--size` conflicts with `--prune`.

Sources: [src/walk.rs:557-575](repo://src/walk.rs#L557-L575), [src/filter/size.rs:68-74](repo://src/filter/size.rs#L68-L74), [src/cli.rs:326-331](repo://src/cli.rs#L326-L331)

## Time filter

`--changed-within` (aliases `--changed-after`, `--newer`, `--change-newer-than`) becomes `TimeFilter::After`, and `--changed-before` (aliases `--older`, `--change-older-than`) becomes `TimeFilter::Before`. Both are optional and may be combined. An argument that parses as none of the accepted forms fails the run with `is not a valid date or duration`.

Sources: [src/cli.rs:419-458](repo://src/cli.rs#L419-L458), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

`TimeFilter::from_str` tries the forms in order, using the `jiff` crate:

Sources: [src/filter/time.rs:28-47](repo://src/filter/time.rs#L28-L47)

1. A `Span` such as `10h`, `1d`, `35min` or `2weeks`, subtracted from the current zoned time.
2. A `Timestamp` with an offset, such as `2010-10-10T10:10:00+00:00`.
3. A civil `DateTime` such as `2018-10-27 10:00:00` or `2018-10-27`, read in the system time zone; an ambiguous local time takes the later instant, and a missing time of day defaults to midnight.
4. `@` followed by Unix seconds, such as `@1288000000`.

Sources: [src/filter/time.rs:28-47](repo://src/filter/time.rs#L28-L47), [src/cli.rs:419-422](repo://src/cli.rs#L419-L422)

`applies_to` compares strictly: `Before` passes when the modification time is earlier than the limit, `After` when it is later. The walker requires every constraint to pass, and drops an entry whose metadata or modification time cannot be read. In tests, `now()` reads a thread-local `TESTTIME` so that durations are computed against a fixed moment.

Sources: [src/filter/time.rs:57-62](repo://src/filter/time.rs#L57-L62), [src/walk.rs:577-591](repo://src/walk.rs#L577-L591), [src/filter/time.rs:12-26](repo://src/filter/time.rs#L12-L26)
