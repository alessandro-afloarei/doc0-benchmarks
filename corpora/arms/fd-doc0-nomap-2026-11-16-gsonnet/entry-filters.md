---
title: "Entry Filters"
---
## Overview

Every entry the walker yields passes through a chain of cheap-to-expensive checks inside the sender closure. An entry reaches the receiver only if all configured checks accept it; a check that is not configured costs nothing. This page lists each check in the order it runs. The loop around them is in [[Parallel Directory Traversal]], and the `Config` fields they read are built in [[Startup and Configuration]].

Sources: [src/walk.rs:514-591](repo://src/walk.rs#L514-L591)

| Order | Check | `Config` field | Needs metadata |
| --- | --- | --- | --- |
| 1 | Name or path regexes | patterns | no |
| 2 | Extension | `extensions` | no |
| 3 | File type | `file_types` | file type, sometimes more |
| 4 | Owner (Unix only) | `owner_constraint` | yes |
| 5 | Size | `size_constraints` | yes |
| 6 | Modification time | `time_constraints` | yes |

Sources: [src/walk.rs:514-591](repo://src/walk.rs#L514-L591)

The order puts name-only checks first because, as the code comments say, "the name first, since it doesn't require metadata".

Sources: [src/walk.rs:514-515](repo://src/walk.rs#L514-L515)

## Pattern match

All patterns must match the search string, which is the file name or, with `--full-path`, the absolute path. Patterns are byte regexes, and the string is passed as raw bytes (`osstr_to_bytes`), which is lossless on Unix and lossy-UTF-8 on Windows. How the regexes are built is on [[Startup and Configuration]].

Sources: [src/walk.rs:517-524](repo://src/walk.rs#L517-L524), [src/filesystem.rs:102-114](repo://src/filesystem.rs#L102-L114)

## Extension

`--extension` values become one case-insensitive `RegexSet` with a pattern `.\.<ext>$` per value after stripping leading dots and escaping. An entry passes if its file name matches any of them; an entry without a file name is rejected.

Sources: [src/main.rs:361-372](repo://src/main.rs#L361-L372), [src/walk.rs:526-535](repo://src/walk.rs#L526-L535)

## File type

`--type` values are folded into a `FileTypes` struct of booleans. `executable` also turns on `files`; `empty` alone turns on both `files` and `directories`, so `fd -t empty` finds empty files and empty directories.

Sources: [src/main.rs:333-359](repo://src/main.rs#L333-L359), [src/filetypes.rs:7-18](repo://src/filetypes.rs#L7-L18)

`should_ignore` rejects an entry when its kind is not enabled, when `executable` is requested and the path is not executable (checked with `faccess`), when `empty` is requested and the entry is not empty, or when it is a kind none of the flags can select. An entry whose file type cannot be read is rejected.

Sources: [src/filetypes.rs:20-43](repo://src/filetypes.rs#L20-L43)

`is_empty` reads the directory and checks for a first entry, or checks that a regular file has length 0; anything else is not empty. Block devices, character devices, sockets and pipes are only detected on Unix and Redox; on Windows those predicates return false.

Sources: [src/filesystem.rs:44-100](repo://src/filesystem.rs#L44-L100)

## Owner

The owner filter exists only on Unix. `OwnerFilter::from_string` accepts `user`, `user:group`, `:group` and a leading `!` on either part to negate it. Each part is a numeric id, or a name looked up with `nix` (`User::from_name` or `Group::from_name`); more than one `:` or an unknown name is an error. A filter whose two parts are empty is a no-op, which `filter_ignore` turns into `None` so the check is skipped.

Sources: [src/filter/owner.rs:5-67](repo://src/filter/owner.rs#L5-L67), [src/filter/owner.rs:85-103](repo://src/filter/owner.rs#L85-L103)

At match time the entry's `uid` and `gid` from its metadata are tested against both parts. An entry whose metadata cannot be read is rejected.

Sources: [src/filter/owner.rs:69-83](repo://src/filter/owner.rs#L69-L83), [src/walk.rs:544-555](repo://src/walk.rs#L544-L555)

## Size

`SizeFilter::from_string` parses `[+-]<number><unit>` with a case-insensitive regex. `+` means at least (`Min`), `-` means at most (`Max`), and no sign means exactly equal (`Equals`). The unit is `b`, or a `k`, `m`, `g` or `t` prefix: `k`/`kb` are powers of 1000, and `ki`/`kib` are powers of 1024, and likewise for the other letters. A string that does not match gives "is not a valid size constraint".

Sources: [src/filter/size.rs:6-66](repo://src/filter/size.rs#L6-L66)

Several `--size` options are all applied, because the walker rejects an entry if any limit is not satisfied. Size applies to regular files only: when any size constraint is set, a directory or other non-file, and a file whose metadata cannot be read, is rejected.

Sources: [src/filter/size.rs:68-74](repo://src/filter/size.rs#L68-L74), [src/walk.rs:557-575](repo://src/walk.rs#L557-L575)

## Modification time

`--changed-within` builds a `TimeFilter::After` and `--changed-before` a `TimeFilter::Before`; an unparsable value gives "is not a valid date or duration". `TimeFilter::from_str` tries, in order:

Sources: [src/filter/time.rs:28-47](repo://src/filter/time.rs#L28-L47)

1. a duration (`jiff::Span`), subtracted from the current time;
2. a full timestamp (`jiff::Timestamp`);
3. a civil date-time, resolved in the system time zone, taking the later of two ambiguous results;
4. `@` followed by Unix seconds.

Sources: [src/main.rs:496-519](repo://src/main.rs#L496-L519), [src/filter/time.rs:28-55](repo://src/filter/time.rs#L28-L55)

`After` accepts entries modified strictly later than the limit and `Before` strictly earlier. The walker requires every time constraint to hold, and an entry whose modification time cannot be read is rejected.

Sources: [src/filter/time.rs:57-63](repo://src/filter/time.rs#L57-L63), [src/walk.rs:577-591](repo://src/walk.rs#L577-L591)

> [!NOTE]
> In unit tests `now()` reads a thread-local test clock instead of the real time, so duration filters can be tested deterministically.

Sources: [src/filter/time.rs:12-26](repo://src/filter/time.rs#L12-L26)
